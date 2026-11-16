import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "../db/client";
import { calls, companies, leads, type Call, type CallSummary } from "../db/schema";
import { notifyOwner } from "../notify";
import { sms } from "../sms/templates";
import { features } from "../env";

export type Summarizer = (input: { call: Call; companyName: string; locale: "nb" | "en" }) => Promise<CallSummary | null>;

let summarizer: Summarizer | null = null;
/** The voice module registers the Claude-based summarizer (tests can swap it). */
export function setSummarizer(fn: Summarizer | null) {
  summarizer = fn;
}

async function getSummarizer(): Promise<Summarizer | null> {
  if (summarizer) return summarizer;
  if (!features.ai()) return null;
  const mod = await import("../../voice/summarize");
  return mod.summarizeCall;
}

function fallbackSummary(call: Call, locale: "nb" | "en"): string {
  const said = call.transcript.filter((e) => e.role === "caller").map((e) => e.text).join(" ");
  if (!said) return locale === "en" ? "The caller hung up before saying anything." : "Innringeren la på før de sa noe.";
  return (locale === "en" ? "Caller said: " : "Innringer sa: ") + (said.length > 280 ? `${said.slice(0, 277)}…` : said);
}

/**
 * Runs once per call after it ends: decides the outcome, writes the AI
 * summary, flags dropped calls and sends owner alerts. Safe to call more than
 * once (the first caller "claims" the call).
 */
export async function postCall(callId: string, companyId: string): Promise<void> {
  const claimed = await withTenant(companyId, async (tx) => {
    const [call] = await tx
      .update(calls)
      .set({ postProcessedAt: new Date() })
      .where(and(eq(calls.id, callId), isNull(calls.postProcessedAt)))
      .returning();
    if (!call) return null;
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    return { call, company };
  });
  if (!claimed) return;
  const { call, company } = claimed;
  const locale = company.locale === "en" ? "en" : "nb";
  const callerSpoke = call.transcript.some((e) => e.role === "caller");

  let outcome = call.outcome ?? (callerSpoke ? (call.leadId ? "lead_captured" : "info") : "hangup");

  let summaryJson: CallSummary | null = null;
  if (callerSpoke && !["spam", "sales", "blocked"].includes(outcome)) {
    try {
      const fn = await getSummarizer();
      summaryJson = fn ? await fn({ call, companyName: company.name, locale }) : null;
    } catch (e) {
      console.error("[post-call] summary failed", e);
    }
  }
  const summary = summaryJson?.summary ?? call.summary ?? fallbackSummary(call, locale);
  if (outcome === "info" && summaryJson?.follow_up) outcome = "lead_captured";

  const endedAt = call.endedAt ?? new Date();
  const flagged = call.flagged || outcome === "hangup" || outcome === "failed" || (!!summaryJson?.follow_up && outcome !== "booked");
  await withTenant(companyId, async (tx) => {
    await tx
      .update(calls)
      .set({
        outcome,
        summary,
        summaryJson,
        status: call.status === "failed" ? "failed" : "completed",
        endedAt,
        durationSeconds: call.durationSeconds ?? Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000)),
        flagged,
        flagReason:
          call.flagReason ??
          (outcome === "hangup"
            ? locale === "en"
              ? "The caller hung up before giving details."
              : "Innringer la på før vi fikk detaljer."
            : summaryJson?.follow_up ?? null),
      })
      .where(eq(calls.id, callId));
    if (call.leadId && summaryJson) {
      // Keep the lead's urgency in line with what the summary concluded.
      await tx.update(leads).set({ urgency: summaryJson.urgency }).where(and(eq(leads.id, call.leadId), eq(leads.urgency, "normal")));
    }
  });

  const base = { companyName: company.name, companyPhone: company.phone, locale, tz: company.timezone } as const;
  const lead = call.leadId ? (await withTenant(companyId, (tx) => tx.select().from(leads).where(eq(leads.id, call.leadId!))))[0] : undefined;
  const refs = { callId, leadId: call.leadId, simulate: call.isTest };
  if (outcome === "hangup" && call.fromNumber) {
    await notifyOwner(company, "missed", sms.ownerMissed({ ...base, phone: call.fromNumber }), refs);
  } else if (outcome === "lead_captured") {
    await notifyOwner(company, "lead", sms.ownerLead({ ...base, name: lead?.name ?? null, phone: lead?.phone ?? call.fromNumber, summary }), refs);
  }
}

/** Twilio's status callback can arrive before the voice socket closes; wait a little. */
export function schedulePostCall(callId: string, companyId: string, delayMs = 4000) {
  setTimeout(() => {
    postCall(callId, companyId).catch((e) => console.error("[post-call]", e));
  }, delayMs).unref?.();
}

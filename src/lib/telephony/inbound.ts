import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "../db/client";
import { calls, companies, jobTypes, phoneNumbers, type Company } from "../db/schema";
import { env } from "../env";
import { signToken } from "../crypto";
import { fullGreeting } from "../greeting";
import { serviceState } from "../billing/status";
import { canForwardNow } from "../hours";
import { conversationRelayTwiml, dialTwiml, rejectTwiml, sayAndHangup } from "./twiml";
import { notifyOwner } from "../notify";
import { sms } from "../sms/templates";

/** Words that help speech recognition with Norwegian trade vocabulary. */
const TRADE_HINTS = [
  "befaring", "rørlegger", "elektriker", "tømrer", "snekker", "taktekker", "bereder", "varmtvannsbereder", "sluk",
  "våtrom", "sikringsskap", "jordfeil", "elbillader", "varmekabler", "takrenne", "lekkasje", "hovedkran", "gulvvarme",
];

export function voiceConfig() {
  const e = env();
  return { ttsProvider: e.TTS_PROVIDER, voiceNb: e.TTS_VOICE_NB, voiceEn: e.TTS_VOICE_EN, sttProvider: e.STT_PROVIDER, sttModelNb: e.STT_MODEL_NB };
}

export function relayUrl(callId: string, companyId: string) {
  const token = signToken({ callId, companyId }, 2 * 3600);
  return `${env().APP_URL.replace(/^http/, "ws")}/api/voice/relay?t=${encodeURIComponent(token)}`;
}

const cb = (path: string, q: Record<string, string> = {}) => {
  const qs = new URLSearchParams(q).toString();
  return `${env().APP_URL}/api/telephony/twilio/${path}${qs ? `?${qs}` : ""}`;
};

/** TwiML that hands the call to the AI receptionist. */
export async function aiTwiml(company: Company, callId: string) {
  const jt = await withTenant(company.id, (tx) => tx.select({ name: jobTypes.name }).from(jobTypes).where(eq(jobTypes.active, true)));
  return conversationRelayTwiml({
    wsUrl: relayUrl(callId, company.id),
    actionUrl: cb("connect-action", { callId }),
    welcomeGreeting: fullGreeting(company),
    language: company.locale === "en" ? "en" : "nb",
    voice: voiceConfig(),
    hints: [company.name, ...jt.map((j) => j.name), ...TRADE_HINTS],
    record: company.recordingEnabled ? { statusCallback: cb("recording", { callId }) } : null,
    params: { callId },
  });
}

export type InboundParams = { callSid: string; from: string | null; to: string; forwardedFrom?: string | null; now?: Date };

/**
 * Decides what happens to an incoming call. Runs in milliseconds so Twilio
 * can answer within the first ring.
 */
export async function handleInboundCall(p: InboundParams): Promise<{ twiml: string; callId?: string; companyId?: string }> {
  const found = await withSystem(async (tx) => {
    const [num] = await tx
      .select({ number: phoneNumbers, company: companies })
      .from(phoneNumbers)
      .innerJoin(companies, eq(companies.id, phoneNumbers.companyId))
      .where(and(eq(phoneNumbers.e164, p.to), eq(phoneNumbers.status, "assigned")))
      .limit(1);
    // Loop guard: a call *from* one of our own numbers is a forwarding loop.
    const loop = p.from ? (await tx.select({ id: phoneNumbers.id }).from(phoneNumbers).where(eq(phoneNumbers.e164, p.from)).limit(1)).length > 0 : false;
    return { num, loop };
  });
  if (!found.num || found.loop || found.num.company.deletionRequestedAt) return { twiml: rejectTwiml(found.loop ? "busy" : "rejected") };
  const { company, number } = found.num;
  const lang = company.locale === "en" ? "en" : "nb";

  // Create (or, on a Twilio retry, reuse) the call record.
  const callId = await withTenant(company.id, async (tx) => {
    const existing = await tx.select({ id: calls.id }).from(calls).where(eq(calls.providerCallSid, p.callSid)).limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await tx
      .insert(calls)
      .values({
        companyId: company.id,
        phoneNumberId: number.id,
        provider: "twilio",
        providerCallSid: p.callSid,
        fromNumber: p.from,
        toNumber: p.to,
        forwardedFrom: p.forwardedFrom ?? null,
        language: lang,
      })
      .returning({ id: calls.id });
    return row.id;
  });

  const finish = (outcome: "blocked" | "service_inactive") =>
    withTenant(company.id, (tx) => tx.update(calls).set({ outcome, status: "completed", endedAt: new Date() }).where(eq(calls.id, callId)));

  if (p.from && company.blockedNumbers.includes(p.from)) {
    await finish("blocked");
    return { twiml: rejectTwiml(), callId, companyId: company.id };
  }

  if (!serviceState(company, p.now).active) {
    await finish("service_inactive");
    void notifyOwner(company, "missed", sms.ownerMissed({ companyName: company.name, companyPhone: company.phone, locale: lang, tz: company.timezone, phone: p.from }), { callId }).catch(console.error);
    const text = lang === "en"
      ? `Thank you for calling ${company.name}. We can't take your call right now. Please try again later.`
      : `Takk for at du ringer ${company.name}. Vi kan dessverre ikke ta telefonen akkurat nå. Prøv gjerne igjen senere.`;
    return { twiml: sayAndHangup(text, lang), callId, companyId: company.id };
  }

  // VIP callers go straight to the owner; if nobody answers, the AI takes over.
  if (p.from && company.vipNumbers.includes(p.from) && canForwardNow(company, p.now)) {
    return {
      twiml: dialTwiml({ number: company.forwardNumber!, callerId: p.to, actionUrl: cb("vip-fallback", { callId }), timeout: 18 }),
      callId,
      companyId: company.id,
    };
  }

  return { twiml: await aiTwiml(company, callId), callId, companyId: company.id };
}

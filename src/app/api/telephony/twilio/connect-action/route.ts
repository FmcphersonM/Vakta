import { eq } from "drizzle-orm";
import { readTwilioRequest, xml } from "@/lib/telephony/webhook";
import { findCall } from "@/lib/telephony/call-lookup";
import { dialTwiml, hangupTwiml, sayAndHangup } from "@/lib/telephony/twiml";
import { canForwardNow } from "@/lib/hours";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Called by Twilio when the AI conversation (ConversationRelay) ends.
 * If the agent asked for a live transfer (emergency / caller wants a human),
 * we dial the owner's mobile here.
 */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const found = await findCall({ id: r.search.get("callId"), sid: r.params.CallSid });
  if (!found) return xml(hangupTwiml());
  const { call, company } = found;
  const lang = company.locale === "en" ? "en" : "nb";

  let handoff: { action?: string; reason?: string } = {};
  try {
    handoff = r.params.HandoffData ? JSON.parse(r.params.HandoffData) : {};
  } catch {
    /* ignore */
  }

  if (r.params.ErrorCode) {
    await withTenant(company.id, (tx) =>
      tx.update(calls).set({ flagged: true, flagReason: `Teknisk feil i samtalen (${r.params.ErrorCode})`, outcome: call.outcome ?? "failed" }).where(eq(calls.id, call.id)),
    );
    return xml(sayAndHangup(lang === "en" ? "Sorry, something went wrong. We will call you back." : "Beklager, noe gikk galt. Vi ringer deg tilbake.", lang));
  }

  if (handoff.action === "transfer" && company.forwardNumber && canForwardNow(company)) {
    return xml(
      dialTwiml({
        number: company.forwardNumber,
        callerId: call.toNumber ?? company.forwardNumber,
        actionUrl: `${env().APP_URL}/api/telephony/twilio/dial-status?callId=${call.id}`,
        timeout: 25,
      }),
    );
  }
  return xml(hangupTwiml());
}

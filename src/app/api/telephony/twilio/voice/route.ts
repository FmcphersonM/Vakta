import { readTwilioRequest, xml } from "@/lib/telephony/webhook";
import { handleInboundCall } from "@/lib/telephony/inbound";
import { normalizePhone } from "@/lib/format";
import { sayAndHangup } from "@/lib/telephony/twiml";

/** Twilio calls this the moment a call comes in. */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const p = r.params;
  try {
    const result = await handleInboundCall({
      callSid: p.CallSid,
      from: normalizePhone(p.From) ?? null,
      to: normalizePhone(p.To) ?? p.To,
      forwardedFrom: normalizePhone(p.ForwardedFrom) ?? null,
    });
    return xml(result.twiml);
  } catch (e) {
    console.error("[voice] inbound failed", e);
    return xml(sayAndHangup("Beklager, vi har tekniske problemer. Prøv igjen om litt."));
  }
}

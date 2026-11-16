import { readTwilioRequest, xml } from "@/lib/telephony/webhook";
import { findCall } from "@/lib/telephony/call-lookup";
import { aiTwiml } from "@/lib/telephony/inbound";
import { hangupTwiml } from "@/lib/telephony/twiml";

/** A VIP caller was put straight through; if the owner didn't answer, the AI takes over. */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const found = await findCall({ id: r.search.get("callId"), sid: r.params.CallSid });
  if (!found) return xml(hangupTwiml());
  if (r.params.DialCallStatus === "completed") return xml(hangupTwiml());
  return xml(await aiTwiml(found.company, found.call.id));
}

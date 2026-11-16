import { eq } from "drizzle-orm";
import { readTwilioRequest, xml } from "@/lib/telephony/webhook";
import { findCall } from "@/lib/telephony/call-lookup";
import { hangupTwiml, sayAndHangup } from "@/lib/telephony/twiml";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";

/** Result of a live transfer to the owner's mobile. */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const found = await findCall({ id: r.search.get("callId"), sid: r.params.CallSid });
  if (!found) return xml(hangupTwiml());
  const { call, company } = found;
  const lang = company.locale === "en" ? "en" : "nb";
  const answered = r.params.DialCallStatus === "completed";
  await withTenant(company.id, (tx) =>
    tx
      .update(calls)
      .set(
        answered
          ? { outcome: call.isEmergency ? "emergency" : "transferred", transferredTo: company.forwardNumber }
          : {
              flagged: true,
              flagReason: lang === "en" ? "Transfer to mobile was not answered – call back." : "Videresending til mobil ble ikke besvart – ring tilbake.",
            },
      )
      .where(eq(calls.id, call.id)),
  );
  if (answered) return xml(hangupTwiml());
  return xml(
    sayAndHangup(
      lang === "en"
        ? "We couldn't reach anyone right now. We have your details and will call you back as soon as possible."
        : "Vi fikk dessverre ikke tak i noen akkurat nå. Vi har notert henvendelsen din og ringer deg tilbake så snart som mulig.",
      lang,
    ),
  );
}

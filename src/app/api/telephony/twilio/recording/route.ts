import { eq } from "drizzle-orm";
import { readTwilioRequest } from "@/lib/telephony/webhook";
import { findCall } from "@/lib/telephony/call-lookup";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";

/** Recording finished: store only the SID; audio stays in Twilio's EU storage. */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const found = await findCall({ id: r.search.get("callId"), sid: r.params.CallSid });
  if (!found) return new Response(null, { status: 204 });
  await withTenant(found.company.id, (tx) =>
    tx
      .update(calls)
      .set({
        recordingSid: r.params.RecordingSid,
        recordingStatus: r.params.RecordingStatus,
        recordingDuration: r.params.RecordingDuration ? Number(r.params.RecordingDuration) : null,
      })
      .where(eq(calls.id, found.call.id)),
  );
  return new Response(null, { status: 204 });
}

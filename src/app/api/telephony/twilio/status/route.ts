import { eq } from "drizzle-orm";
import { readTwilioRequest } from "@/lib/telephony/webhook";
import { findCall } from "@/lib/telephony/call-lookup";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { schedulePostCall } from "@/lib/calls/post-call";

const DONE = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

/** Twilio call status callback (call ended). */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const status = r.params.CallStatus;
  if (!DONE.has(status)) return new Response(null, { status: 204 });
  const found = await findCall({ sid: r.params.CallSid });
  if (!found) return new Response(null, { status: 204 });
  const { call, company } = found;
  const duration = Number(r.params.CallDuration ?? "");
  await withTenant(company.id, (tx) =>
    tx
      .update(calls)
      .set({
        status: status === "completed" ? "completed" : "failed",
        endedAt: call.endedAt ?? new Date(),
        durationSeconds: Number.isFinite(duration) && r.params.CallDuration ? duration : call.durationSeconds,
      })
      .where(eq(calls.id, call.id)),
  );
  schedulePostCall(call.id, company.id);
  return new Response(null, { status: 204 });
}

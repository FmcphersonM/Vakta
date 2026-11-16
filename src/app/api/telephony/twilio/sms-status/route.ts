import { eq } from "drizzle-orm";
import { readTwilioRequest } from "@/lib/telephony/webhook";
import { withSystem } from "@/lib/db/client";
import { smsMessages } from "@/lib/db/schema";

const MAP: Record<string, string> = { queued: "queued", sending: "queued", sent: "sent", delivered: "delivered", undelivered: "undelivered", failed: "failed" };

export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const status = MAP[r.params.MessageStatus];
  if (status && r.params.MessageSid) {
    await withSystem((tx) =>
      tx
        .update(smsMessages)
        .set({ status, error: r.params.ErrorCode ? `Twilio error ${r.params.ErrorCode}` : null })
        .where(eq(smsMessages.providerSid, r.params.MessageSid)),
    );
  }
  return new Response(null, { status: 204 });
}

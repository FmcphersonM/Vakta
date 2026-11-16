import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { getTelephony } from "@/lib/telephony/provider";

/**
 * Streams a call recording to a logged-in member of the owning company.
 * Provider URLs are never exposed to the browser.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const cur = await getCurrentSession();
  if (!cur || cur.session.mfaPending || !cur.session.companyId) return new Response("Unauthorized", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(callId)) return new Response("Not found", { status: 404 });
  const [call] = await withTenant(cur.session.companyId, (tx) =>
    tx.select({ recordingSid: calls.recordingSid, deleted: calls.recordingDeletedAt }).from(calls).where(eq(calls.id, callId)),
  );
  if (!call?.recordingSid || call.deleted) return new Response("Not found", { status: 404 });
  const upstream = await (await getTelephony()).fetchRecording(call.recordingSid);
  if (!upstream.ok || !upstream.body) return new Response("Recording unavailable", { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}

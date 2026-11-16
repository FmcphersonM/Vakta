import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { features } from "@/lib/env";
import { endSimulation, simulateUtterance, startSimulation, type SimEvent } from "@/voice/simulator";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("say"), id: z.string().min(10).max(64), text: z.string().min(1).max(1000) }),
  z.object({ action: z.literal("end"), id: z.string().min(10).max(64) }),
]);

/** Browser test calls: start / say something / end. Replies stream as server-sent events. */
export async function POST(req: Request) {
  const cur = await getCurrentSession();
  if (!cur || cur.session.mfaPending || !cur.session.companyId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const companyId = cur.session.companyId;
  const [member] = await withTenant(companyId, (tx) =>
    tx.select().from(memberships).where(and(eq(memberships.companyId, companyId), eq(memberships.userId, cur.user.id))),
  );
  if (!member) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!features.ai()) return Response.json({ error: "ai_not_configured" }, { status: 503 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const p = parsed.data;

  if (p.action === "start") {
    return Response.json(await startSimulation(companyId, cur.user.id, cur.user.phone));
  }
  if (p.action === "end") {
    return Response.json({ callId: await endSimulation(p.id, cur.user.id) });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SimEvent | { type: "done"; ended: unknown } | { type: "error" }) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const r = await simulateUtterance(p.id, cur.user.id, p.text, send);
        send({ type: "done", ended: r.ended });
      } catch (e) {
        console.error("[simulator]", e);
        send({ type: "error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}

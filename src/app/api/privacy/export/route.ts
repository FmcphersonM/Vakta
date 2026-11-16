import { and, eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/format";
import { exportByPhone } from "@/lib/gdpr/erasure";

/** GDPR access request: download everything held about one phone number. */
export async function GET(req: Request) {
  const cur = await getCurrentSession();
  if (!cur || cur.session.mfaPending || !cur.session.companyId) return new Response("Unauthorized", { status: 401 });
  const companyId = cur.session.companyId;
  const [m] = await withTenant(companyId, (tx) =>
    tx.select().from(memberships).where(and(eq(memberships.userId, cur.user.id), eq(memberships.companyId, companyId))),
  );
  if (!m || m.role === "member") return new Response("Forbidden", { status: 403 });
  const phone = normalizePhone(new URL(req.url).searchParams.get("phone"));
  if (!phone) return new Response("Invalid phone number", { status: 400 });
  const data = await exportByPhone(companyId, phone, cur.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="innsyn-${phone.replace("+", "")}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

/** Used by the hosting platform to check the service is alive. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

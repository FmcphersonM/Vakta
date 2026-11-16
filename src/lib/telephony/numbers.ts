import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { phoneNumbers } from "../db/schema";

/** Test numbers used until Twilio is connected (+47 21 49 00 xx). */
export async function ensureMockNumberPool(tx: Tx, size: number) {
  const free = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.provider, "mock"), eq(phoneNumbers.status, "available")));
  const missing = size - (free[0]?.n ?? 0);
  if (missing <= 0) return;
  const [maxRow] = await tx
    .select({ max: sql<string | null>`max(e164)` })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.provider, "mock"));
  let next = maxRow?.max ? Number(maxRow.max.slice(-4)) + 1 : 1;
  const rows = Array.from({ length: missing }, () => ({
    e164: `+472149${String(next++).padStart(4, "0")}`,
    provider: "mock" as const,
    smsCapable: true,
    status: "available" as const,
  }));
  await tx.insert(phoneNumbers).values(rows).onConflictDoNothing();
}

/** Atomically take a free number from the pool for a company (system context). */
export async function claimPoolNumber(tx: Tx, companyId: string, provider: "twilio" | "mock") {
  const [free] = await tx
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.provider, provider), eq(phoneNumbers.status, "available"), isNull(phoneNumbers.companyId)))
    .orderBy(asc(phoneNumbers.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!free) return null;
  const [claimed] = await tx
    .update(phoneNumbers)
    .set({ companyId, status: "assigned", assignedAt: new Date() })
    .where(eq(phoneNumbers.id, free.id))
    .returning();
  return claimed;
}

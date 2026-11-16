import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { phoneNumbers } from "../db/schema";
import { withSystem } from "../db/client";
import { features, env } from "../env";
import { getTelephony } from "./provider";
import { audit } from "../audit";
import type { TwilioTelephony } from "./twilio";

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

// ── Assigning numbers to companies ───────────────────────────────────────────

export async function companyNumber(tx: Tx, companyId: string) {
  const [n] = await tx
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.companyId, companyId), eq(phoneNumbers.status, "assigned")))
    .limit(1);
  return n ?? null;
}

/**
 * Gives a company its Norwegian number — instantly from the pre-bought pool,
 * or by buying one on the spot if the pool is empty.
 */
export async function assignNumber(companyId: string, userId: string | null) {
  const provider = features.twilio() ? "twilio" : "mock";
  const existing = await withSystem((tx) => companyNumber(tx, companyId));
  if (existing) return existing;

  let number = await withSystem(async (tx) => {
    if (provider === "mock") await ensureMockNumberPool(tx, 3);
    return claimPoolNumber(tx, companyId, provider);
  });
  if (!number && provider === "twilio") {
    const bought = await (await getTelephony()).buyNumber();
    [number] = await withSystem((tx) =>
      tx
        .insert(phoneNumbers)
        .values({ e164: bought.e164, provider: "twilio", providerSid: bought.sid, smsCapable: bought.smsCapable, companyId, status: "assigned", assignedAt: new Date() })
        .returning(),
    );
  }
  if (!number) throw new Error("No phone number available");
  await withSystem((tx) =>
    audit(tx, { companyId, userId, action: "phone.assigned", entityType: "phone_number", entityId: number!.id, metadata: { e164: number!.e164 } }),
  );
  void replenishPool().catch((e) => console.error("[numbers] replenish failed", e));
  return number;
}

/** Keep NUMBER_POOL_SIZE spare numbers so onboarding never waits on a purchase. */
export async function replenishPool() {
  if (!features.twilio()) return 0;
  const want = env().NUMBER_POOL_SIZE;
  const free = await withSystem((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.provider, "twilio"), eq(phoneNumbers.status, "available"))),
  );
  let bought = 0;
  for (let i = free[0]?.n ?? 0; i < want; i++) {
    const n = await (await getTelephony()).buyNumber();
    await withSystem((tx) =>
      tx.insert(phoneNumbers).values({ e164: n.e164, provider: "twilio", providerSid: n.sid, smsCapable: n.smsCapable, status: "available" }).onConflictDoNothing(),
    );
    bought++;
  }
  return bought;
}

/** Import numbers that already exist in the Twilio account into the pool. */
export async function importTwilioNumbers() {
  const tel = (await getTelephony()) as TwilioTelephony;
  const owned = await tel.listOwnedNumbers();
  let added = 0;
  for (const n of owned) {
    await tel.configureNumber(n.sid);
    const r = await withSystem((tx) =>
      tx
        .insert(phoneNumbers)
        .values({ e164: n.e164, provider: "twilio", providerSid: n.sid, smsCapable: n.smsCapable, status: "available" })
        .onConflictDoNothing()
        .returning(),
    );
    added += r.length;
  }
  return { owned: owned.length, added };
}

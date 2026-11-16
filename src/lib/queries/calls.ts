import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { withTenant } from "../db/client";
import { calls, leads } from "../db/schema";
import { needsAttention } from "./dashboard";

export const CALL_FILTERS = ["all", "flagged", "booked", "missed", "spam"] as const;
export type CallFilter = (typeof CALL_FILTERS)[number];

export async function listCalls(companyId: string, filter: CallFilter) {
  const where: Record<CallFilter, SQL | undefined> = {
    all: undefined,
    flagged: needsAttention,
    booked: eq(calls.outcome, "booked"),
    missed: inArray(calls.outcome, ["hangup", "failed"]),
    spam: or(eq(calls.outcome, "spam"), eq(calls.outcome, "sales"), eq(calls.outcome, "blocked")),
  };
  return withTenant(companyId, (tx) =>
    tx
      .select({
        id: calls.id,
        fromNumber: calls.fromNumber,
        startedAt: calls.startedAt,
        durationSeconds: calls.durationSeconds,
        outcome: calls.outcome,
        isEmergency: calls.isEmergency,
        isTest: calls.isTest,
        summary: calls.summary,
        reviewedAt: calls.reviewedAt,
        flagged: calls.flagged,
        leadName: leads.name,
      })
      .from(calls)
      .leftJoin(leads, eq(leads.id, calls.leadId))
      .where(where[filter])
      .orderBy(desc(calls.startedAt))
      .limit(200),
  );
}

export async function getCall(companyId: string, id: string) {
  return withTenant(companyId, async (tx) => {
    const [row] = await tx
      .select({ call: calls, lead: leads })
      .from(calls)
      .leftJoin(leads, eq(leads.id, calls.leadId))
      .where(and(eq(calls.id, id)))
      .limit(1);
    return row ?? null;
  });
}

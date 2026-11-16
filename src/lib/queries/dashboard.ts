import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { withTenant } from "../db/client";
import { appointments, calls, leads, memberships, users } from "../db/schema";
import { TZ } from "../format";

export const needsAttention = and(
  isNull(calls.reviewedAt),
  eq(calls.isTest, false),
  or(eq(calls.flagged, true), eq(calls.isEmergency, true), inArray(calls.outcome, ["hangup", "failed", "emergency"])),
);

export async function attentionCount(companyId: string) {
  const [r] = await withTenant(companyId, (tx) => tx.select({ n: count() }).from(calls).where(needsAttention));
  return r?.n ?? 0;
}

export async function todayData(companyId: string, tz = TZ) {
  const now = DateTime.now().setZone(tz);
  const dayStart = now.startOf("day").toJSDate();
  const dayEnd = now.endOf("day").toJSDate();
  const upcomingEnd = now.plus({ days: 7 }).endOf("day").toJSDate();
  return withTenant(companyId, async (tx) => {
    const apptCols = {
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      address: appointments.address,
      customerName: appointments.customerName,
      customerPhone: appointments.customerPhone,
      leadId: appointments.leadId,
      assignedName: users.name,
      color: memberships.color,
    };
    const base = tx
      .select(apptCols)
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.assignedUserId))
      .leftJoin(
        memberships,
        and(eq(memberships.userId, appointments.assignedUserId), eq(memberships.companyId, appointments.companyId)),
      );
    const today = await base
      .where(and(eq(appointments.status, "scheduled"), gte(appointments.startsAt, dayStart), lt(appointments.startsAt, dayEnd)))
      .orderBy(asc(appointments.startsAt));
    const upcoming = await tx
      .select(apptCols)
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.assignedUserId))
      .leftJoin(
        memberships,
        and(eq(memberships.userId, appointments.assignedUserId), eq(memberships.companyId, appointments.companyId)),
      )
      .where(and(eq(appointments.status, "scheduled"), gte(appointments.startsAt, dayEnd), lt(appointments.startsAt, upcomingEnd)))
      .orderBy(asc(appointments.startsAt))
      .limit(8);
    const newLeads = await tx
      .select()
      .from(leads)
      .where(eq(leads.status, "new"))
      .orderBy(sql`case ${leads.urgency} when 'emergency' then 0 when 'high' then 1 else 2 end`, desc(leads.createdAt))
      .limit(8);
    const [newLeadCount] = await tx.select({ n: count() }).from(leads).where(eq(leads.status, "new"));
    const flagged = await tx
      .select({
        id: calls.id,
        fromNumber: calls.fromNumber,
        startedAt: calls.startedAt,
        outcome: calls.outcome,
        isEmergency: calls.isEmergency,
        flagReason: calls.flagReason,
        summary: calls.summary,
        leadName: leads.name,
      })
      .from(calls)
      .leftJoin(leads, eq(leads.id, calls.leadId))
      .where(needsAttention)
      .orderBy(desc(calls.isEmergency), desc(calls.startedAt))
      .limit(10);
    const [anyCall] = await tx.select({ n: count() }).from(calls);
    return { today, upcoming, newLeads, newLeadCount: newLeadCount?.n ?? 0, flagged, hasCalls: (anyCall?.n ?? 0) > 0 };
  });
}

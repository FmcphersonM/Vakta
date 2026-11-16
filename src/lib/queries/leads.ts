import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { withTenant } from "../db/client";
import { appointments, calls, jobTypes, leads, smsMessages, users, type LeadStatus } from "../db/schema";

export const LEAD_STATUSES: LeadStatus[] = ["new", "booked", "quoted", "won", "lost"];

export async function listLeads(companyId: string, opts: { status?: string; q?: string }) {
  return withTenant(companyId, async (tx) => {
    const conds: SQL[] = [];
    if (opts.status && (LEAD_STATUSES as string[]).includes(opts.status)) conds.push(eq(leads.status, opts.status as LeadStatus));
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim().replace(/[%_]/g, "")}%`;
      const digits = opts.q.replace(/\D/g, "");
      conds.push(
        or(
          ilike(leads.name, q),
          ilike(leads.address, q),
          ilike(leads.jobTypeText, q),
          digits.length >= 3 ? ilike(leads.phone, `%${digits}%`) : undefined,
        )!,
      );
    }
    const rows = await tx
      .select()
      .from(leads)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(leads.createdAt))
      .limit(200);
    const counts = await tx.select({ status: leads.status, n: count() }).from(leads).groupBy(leads.status);
    return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
  });
}

export async function getLead(companyId: string, id: string) {
  return withTenant(companyId, async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) return null;
    const appts = await tx
      .select({
        id: appointments.id,
        title: appointments.title,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        assignedName: users.name,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.assignedUserId))
      .where(eq(appointments.leadId, id))
      .orderBy(desc(appointments.startsAt));
    const callRows = await tx
      .select({ id: calls.id, startedAt: calls.startedAt, outcome: calls.outcome, durationSeconds: calls.durationSeconds, summary: calls.summary })
      .from(calls)
      .where(lead.phone ? or(eq(calls.leadId, id), eq(calls.fromNumber, lead.phone)) : eq(calls.leadId, id))
      .orderBy(desc(calls.startedAt));
    const types = await tx.select().from(jobTypes).where(eq(jobTypes.active, true)).orderBy(jobTypes.sort);
    const sms = await tx
      .select()
      .from(smsMessages)
      .where(lead.phone ? or(eq(smsMessages.leadId, id), eq(smsMessages.toNumber, lead.phone)) : eq(smsMessages.leadId, id))
      .orderBy(desc(smsMessages.createdAt))
      .limit(20);
    return { lead, appts, calls: callRows, jobTypes: types, sms };
  });
}


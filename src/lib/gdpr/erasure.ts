import { eq, inArray, or } from "drizzle-orm";
import { withTenant } from "../db/client";
import { appointments, calls, leads, privacyRequests, smsMessages } from "../db/schema";
import { audit } from "../audit";
import { sha256 } from "../crypto";

export type ErasureResult = { leads: number; calls: number; appointments: number; sms: number; recordings: number };

/**
 * GDPR art. 17: delete everything a company holds about one phone number —
 * leads, calls (transcripts, summaries), recordings at the phone provider,
 * befaringer (also removed from synced calendars) and SMS.
 */
export async function eraseByPhone(opts: {
  companyId: string;
  phone: string;
  userId: string | null;
  deleteRecording: (sid: string) => Promise<void>;
  deleteCalendarEvents?: (appointmentIds: string[]) => Promise<void>;
}): Promise<ErasureResult> {
  const { companyId, phone } = opts;
  const found = await withTenant(companyId, async (tx) => {
    const leadRows = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone));
    const leadIds = leadRows.map((l) => l.id);
    const callRows = await tx
      .select({ id: calls.id, recordingSid: calls.recordingSid })
      .from(calls)
      .where(leadIds.length ? or(eq(calls.fromNumber, phone), inArray(calls.leadId, leadIds)) : eq(calls.fromNumber, phone));
    const apptRows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        leadIds.length ? or(eq(appointments.customerPhone, phone), inArray(appointments.leadId, leadIds)) : eq(appointments.customerPhone, phone),
      );
    return { leadIds, callRows, apptIds: apptRows.map((a) => a.id) };
  });

  // External systems first, so a failure leaves our records in place to retry.
  let recordings = 0;
  for (const c of found.callRows) {
    if (c.recordingSid) {
      await opts.deleteRecording(c.recordingSid);
      recordings++;
    }
  }
  if (found.apptIds.length && opts.deleteCalendarEvents) await opts.deleteCalendarEvents(found.apptIds);

  return withTenant(companyId, async (tx) => {
    const callIds = found.callRows.map((c) => c.id);
    const sms = await tx
      .delete(smsMessages)
      .where(
        or(
          eq(smsMessages.toNumber, phone),
          found.leadIds.length ? inArray(smsMessages.leadId, found.leadIds) : undefined,
          callIds.length ? inArray(smsMessages.callId, callIds) : undefined,
        ),
      )
      .returning({ id: smsMessages.id });
    const appts = found.apptIds.length
      ? await tx.delete(appointments).where(inArray(appointments.id, found.apptIds)).returning({ id: appointments.id })
      : [];
    const cs = callIds.length ? await tx.delete(calls).where(inArray(calls.id, callIds)).returning({ id: calls.id }) : [];
    const ls = found.leadIds.length
      ? await tx.delete(leads).where(inArray(leads.id, found.leadIds)).returning({ id: leads.id })
      : [];
    const result: ErasureResult = { leads: ls.length, calls: cs.length, appointments: appts.length, sms: sms.length, recordings };
    // Keep proof that the request was handled, without keeping the number itself.
    await tx.insert(privacyRequests).values({
      companyId,
      kind: "erasure",
      subjectPhone: `sha256:${sha256(phone).slice(0, 16)}`,
      requestedBy: opts.userId,
      result,
      completedAt: new Date(),
    });
    await audit(tx, {
      companyId,
      userId: opts.userId,
      action: "privacy.erasure",
      entityType: "phone",
      entityId: `sha256:${sha256(phone).slice(0, 16)}`,
      metadata: result,
    });
    return result;
  });
}

/** GDPR art. 15: everything held about one phone number, as JSON. */
export async function exportByPhone(companyId: string, phone: string, userId: string | null) {
  return withTenant(companyId, async (tx) => {
    const leadRows = await tx.select().from(leads).where(eq(leads.phone, phone));
    const callRows = await tx.select().from(calls).where(eq(calls.fromNumber, phone));
    const apptRows = await tx.select().from(appointments).where(eq(appointments.customerPhone, phone));
    const smsRows = await tx.select().from(smsMessages).where(eq(smsMessages.toNumber, phone));
    await tx.insert(privacyRequests).values({
      companyId,
      kind: "export",
      subjectPhone: `sha256:${sha256(phone).slice(0, 16)}`,
      requestedBy: userId,
      result: { leads: leadRows.length, calls: callRows.length, appointments: apptRows.length, sms: smsRows.length },
      completedAt: new Date(),
    });
    await audit(tx, { companyId, userId, action: "privacy.export", entityType: "phone", entityId: `sha256:${sha256(phone).slice(0, 16)}` });
    return {
      exportedAt: new Date().toISOString(),
      phone,
      leads: leadRows,
      calls: callRows.map((c) => ({ ...c, recording: c.recordingSid ? "available on request" : null })),
      appointments: apptRows,
      sms: smsRows,
    };
  });
}


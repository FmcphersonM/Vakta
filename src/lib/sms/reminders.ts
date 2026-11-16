import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { withSystem, withTenant } from "../db/client";
import { appointments, companies } from "../db/schema";
import { sendSms } from "./index";
import { sms } from "./templates";

/**
 * Text customers the day before their befaring (for befaringer 18–30 hours
 * ahead, so a single hourly run catches every one exactly once).
 */
export async function sendDueReminders(now = new Date()) {
  const from = new Date(now.getTime() + 18 * 3600_000);
  const to = new Date(now.getTime() + 30 * 3600_000);
  const due = await withSystem((tx) =>
    tx
      .select({ appt: appointments, company: companies })
      .from(appointments)
      .innerJoin(companies, eq(companies.id, appointments.companyId))
      .where(
        and(
          eq(appointments.status, "scheduled"),
          isNull(appointments.reminderSentAt),
          isNotNull(appointments.customerPhone),
          gt(appointments.startsAt, from),
          lt(appointments.startsAt, to),
          eq(companies.sendReminders, true),
        ),
      )
      .limit(500),
  );
  let sent = 0;
  for (const { appt, company } of due) {
    // Claim first so a parallel run can't send twice.
    const claimed = await withTenant(company.id, (tx) =>
      tx.update(appointments).set({ reminderSentAt: now }).where(and(eq(appointments.id, appt.id), isNull(appointments.reminderSentAt))).returning({ id: appointments.id }),
    );
    if (!claimed.length) continue;
    await sendSms({
      companyId: company.id,
      company,
      to: appt.customerPhone!,
      purpose: "reminder",
      appointmentId: appt.id,
      leadId: appt.leadId,
      body: sms.reminder({
        companyName: company.name,
        companyPhone: company.phone,
        locale: company.locale === "en" ? "en" : "nb",
        tz: company.timezone,
        name: appt.customerName,
        start: appt.startsAt,
        address: appt.address,
      }),
    });
    sent++;
  }
  return sent;
}

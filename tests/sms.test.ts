import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { appointments, companies, smsMessages } from "@/lib/db/schema";
import { sendSms, senderFor } from "@/lib/sms";
import { sms } from "@/lib/sms/templates";
import { sendDueReminders } from "@/lib/sms/reminders";
import { notifyOwner } from "@/lib/notify";
import { createAppointment, moveAppointment } from "@/lib/appointments";
import { setTelephonyForTests, type TelephonyProvider } from "@/lib/telephony/provider";
import { POST as smsStatus } from "@/app/api/telephony/twilio/sms-status/route";
import { makeCompany } from "./helpers";

afterEach(() => setTelephonyForTests(undefined));
afterAll(closeDb);

const base = { companyName: "Fjordbyen Rør AS", companyPhone: "+4722334455", tz: "Europe/Oslo" };
const start = new Date("2026-11-17T08:30:00Z"); // Tue 09:30 Oslo

describe("SMS texts", () => {
  it("are short, friendly and in the company's language", () => {
    expect(sms.bookingConfirmation({ ...base, locale: "nb", name: "Ola Nordmann", start, address: "Kirkegata 15, 0153 Oslo" })).toBe(
      "Hei Ola! Befaring hos Fjordbyen Rør AS er bekreftet tirsdag 17. november kl. 09:30, Kirkegata 15, 0153 Oslo. Spørsmål? Ring 22 33 44 55.",
    );
    expect(sms.bookingConfirmation({ ...base, locale: "en", name: null, start, address: null })).toBe(
      "Hi! Your site visit with Fjordbyen Rør AS is confirmed for Tuesday 17 November at 09:30. Questions? Call 22 33 44 55.",
    );
    expect(sms.reminder({ ...base, locale: "nb", name: "Ola", start, address: null })).toContain("Påminnelse: befaring fra Fjordbyen Rør AS tirsdag 17. november kl. 09:30");
    expect(sms.ownerEmergency({ ...base, locale: "nb", name: "Kari", phone: "+4740000001", summary: "Vannlekkasje i kjeller" })).toBe(
      "AKUTT samtale: Kari, 400 00 001. Vannlekkasje i kjeller Ring tilbake nå.",
    );
    for (const t of [sms.bookingConfirmation({ ...base, locale: "nb", name: "Ola Nordmann", start, address: "Kirkegata 15, 0153 Oslo" })]) {
      expect(t.length).toBeLessThanOrEqual(160 * 2);
    }
  });
  it("uses the company's alphanumeric sender name, or the default", () => {
    expect(senderFor({ smsSenderName: "FjordbyRor" })).toBe("FjordbyRor");
    expect(senderFor({ smsSenderName: null })).toBe("Vakta");
  });
});

describe("sending", () => {
  it("logs every SMS and never throws when the provider fails", async () => {
    const c = await makeCompany();
    setTelephonyForTests({ name: "twilio", sendSms: async () => { throw new Error("network down"); } } as unknown as TelephonyProvider);
    const r = await sendSms({ companyId: c.companyId, company: { smsSenderName: null }, to: "+4740000001", body: "Hei", purpose: "other" });
    expect(r.status).toBe("failed");
    const [row] = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(row).toMatchObject({ status: "failed", error: "network down", provider: "twilio", sender: "Vakta" });
  });

  it("updates delivery status from Twilio's callback", async () => {
    const c = await makeCompany();
    setTelephonyForTests({ name: "twilio", sendSms: async () => ({ sid: "SM123abc", status: "queued" }) } as unknown as TelephonyProvider);
    await sendSms({ companyId: c.companyId, company: { smsSenderName: "Test" }, to: "+4740000002", body: "Hei", purpose: "other" });
    const res = await smsStatus(
      new Request("http://localhost/api/telephony/twilio/sms-status", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ MessageSid: "SM123abc", MessageStatus: "delivered" }),
      }),
    );
    expect(res.status).toBe(204);
    const [row] = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(row.status).toBe("delivered");
  });

  it("alerts the owner only for the events they chose", async () => {
    const c = await makeCompany();
    const company = { id: c.companyId, notifyOn: ["emergency"], notifyNumbers: [] as string[], forwardNumber: "+4791234567", smsSenderName: null };
    expect(await notifyOwner(company, "lead", "x")).toBe(0);
    expect(await notifyOwner(company, "emergency", "AKUTT")).toBe(1);
    expect(await notifyOwner({ ...company, notifyNumbers: ["+4790000001", "+4790000002"] }, "emergency", "AKUTT")).toBe(2);
    const rows = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(rows.map((r) => r.toNumber).sort()).toEqual(["+4790000001", "+4790000002", "+4791234567"]);
  });
});

describe("day-before reminders", () => {
  it("texts each customer once, and again if the befaring is moved", async () => {
    const c = await makeCompany();
    await withSystem((tx) => tx.update(companies).set({ smsSenderName: "TestRor" }).where(eq(companies.id, c.companyId)));
    const now = new Date();
    const appt = await createAppointment({
      companyId: c.companyId,
      actor: { userId: c.userId, kind: "user" },
      assignedUserId: c.userId,
      title: "Befaring",
      startsAt: new Date(now.getTime() + 24 * 3600_000),
      endsAt: new Date(now.getTime() + 24.75 * 3600_000),
      customerName: "Per",
      customerPhone: "+4740000009",
    });
    expect(await sendDueReminders(now)).toBeGreaterThanOrEqual(1);
    expect(await sendDueReminders(now)).toBe(0);
    let rows = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages).where(eq(smsMessages.appointmentId, appt.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("reminder");

    await moveAppointment({ companyId: c.companyId, id: appt.id, startsAt: new Date(now.getTime() + 25 * 3600_000), endsAt: new Date(now.getTime() + 25.75 * 3600_000), actor: { userId: c.userId, kind: "user" } });
    const [moved] = await withTenant(c.companyId, (tx) => tx.select().from(appointments).where(eq(appointments.id, appt.id)));
    expect(moved.reminderSentAt).toBeNull();
    await sendDueReminders(now);
    rows = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages).where(eq(smsMessages.appointmentId, appt.id)));
    expect(rows).toHaveLength(2);
  });
});

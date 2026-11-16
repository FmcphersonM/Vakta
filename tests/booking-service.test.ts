import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { appointments, busyBlocks, calendarConnections, calls, companies, leads, memberships } from "@/lib/db/schema";
import { bookingService } from "@/lib/booking/service";
import { makeCompany } from "./helpers";

afterAll(closeDb);

async function setup() {
  const c = await makeCompany();
  await withSystem((tx) =>
    tx
      .update(companies)
      .set({ baseAddress: "Kirkegata 15, 0153 Oslo", baseLat: 59.9104, baseLng: 10.7445, minNoticeHours: 0, onboardingStep: "done" })
      .where(eq(companies.id, c.companyId)),
  );
  const [company] = await withTenant(c.companyId, (tx) => tx.select().from(companies));
  const { leadId, callId } = await withTenant(c.companyId, async (tx) => {
    const [l] = await tx.insert(leads).values({ companyId: c.companyId, name: "Test Kunde", phone: "+4740000001" }).returning();
    const [call] = await tx.insert(calls).values({ companyId: c.companyId, fromNumber: "+4740000001" }).returning();
    return { leadId: l.id, callId: call.id };
  });
  return { ...c, company, leadId, callId };
}

const details = (s: Awaited<ReturnType<typeof setup>>) => ({
  leadId: s.leadId,
  callId: s.callId,
  title: "Befaring: Bad",
  address: "Thereses gate 22, 0168 Oslo",
  lat: 59.9283,
  lng: 10.7301,
  name: "Test Kunde",
  phone: "+4740000001",
  notes: null,
});

describe("booking service (database + engine)", () => {
  it("finds slots for team members who do befaringer and books one", async () => {
    const s = await setup();
    const slots = await bookingService.findSlots(s.company, { lat: 59.9283, lng: 10.7301, minutes: 45 });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].userId).toBe(s.userId);
    const appt = await bookingService.book(s.company, slots[0], details(s));
    expect(appt.assigneeName).toMatch(/^Eier/);
    const [row] = await withTenant(s.companyId, (tx) => tx.select().from(appointments).where(eq(appointments.id, appt.id)));
    expect(row).toMatchObject({ customerName: "Test Kunde", createdBy: "ai", status: "scheduled", leadId: s.leadId, callId: s.callId });
    const [lead] = await withTenant(s.companyId, (tx) => tx.select().from(leads).where(eq(leads.id, s.leadId)));
    expect(lead.status).toBe("booked");
    // The same slot can't be booked twice.
    await expect(bookingService.book(s.company, slots[0], details(s))).rejects.toThrow("slot_conflict");
    const next = await bookingService.findSlots(s.company, { lat: 59.9283, lng: 10.7301, minutes: 45 });
    expect(next.some((x) => x.start.getTime() === slots[0].start.getTime() && x.userId === s.userId)).toBe(false);
  });

  it("skips people who don't do befaringer and respects their calendar busy time", async () => {
    const s = await setup();
    await withTenant(s.companyId, (tx) => tx.update(memberships).set({ doesBefaring: false }).where(eq(memberships.userId, s.userId)));
    expect(await bookingService.findSlots(s.company, { lat: null, lng: null, minutes: 45 })).toEqual([]);
    await withTenant(s.companyId, (tx) => tx.update(memberships).set({ doesBefaring: true }).where(eq(memberships.userId, s.userId)));

    // Busy the whole first two weeks except one window.
    const tz = s.company.timezone;
    const day = DateTime.now().setZone(tz).plus({ days: 1 }).startOf("day");
    await withTenant(s.companyId, async (tx) => {
      const [conn] = await tx.insert(calendarConnections).values({ companyId: s.companyId, userId: s.userId, provider: "google" }).returning();
      await tx.insert(busyBlocks).values({ companyId: s.companyId, userId: s.userId, connectionId: conn.id, startsAt: DateTime.now().toJSDate(), endsAt: day.plus({ days: 30 }).toJSDate() });
    });
    expect(await bookingService.findSlots(s.company, { lat: null, lng: null, minutes: 45 })).toEqual([]);
  });
});

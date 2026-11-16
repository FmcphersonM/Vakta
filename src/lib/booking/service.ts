import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { withTenant } from "../db/client";
import { appointments, busyBlocks, memberships, users, type Company } from "../db/schema";
import { findSlots, inServiceArea, type Busy } from "./engine";
import { createAppointment, SlotConflictError } from "../appointments";
import { refreshBusyForCompany } from "../calendar/sync";
import type { BookingService, Slot } from "../../voice/tools";

async function loadAvailability(companyId: string, from: Date, to: Date) {
  return withTenant(companyId, async (tx) => {
    const workers = await tx
      .select({ userId: memberships.userId, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.doesBefaring, true));
    const ids = workers.map((w) => w.userId);
    if (!ids.length) return { workers, busy: [] as Busy[] };
    const appts = await tx
      .select({ userId: appointments.assignedUserId, start: appointments.startsAt, end: appointments.endsAt, lat: appointments.lat, lng: appointments.lng })
      .from(appointments)
      .where(and(eq(appointments.status, "scheduled"), inArray(appointments.assignedUserId, ids), lt(appointments.startsAt, to), gt(appointments.endsAt, from)));
    const blocks = await tx
      .select({ userId: busyBlocks.userId, start: busyBlocks.startsAt, end: busyBlocks.endsAt })
      .from(busyBlocks)
      .where(and(inArray(busyBlocks.userId, ids), lt(busyBlocks.startsAt, to), gt(busyBlocks.endsAt, from)));
    const busy: Busy[] = [
      ...appts.map((a) => ({
        userId: a.userId!,
        start: a.start,
        end: a.end,
        location: a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null,
        kind: "appointment" as const,
      })),
      ...blocks.map((b) => ({ userId: b.userId, start: b.start, end: b.end, kind: "external" as const })),
    ];
    return { workers, busy };
  });
}

function engineInput(company: Company, workers: string[], busy: Busy[], target: { lat: number; lng: number } | null, minutes: number) {
  return {
    now: new Date(),
    tz: company.timezone,
    hours: company.businessHours,
    minutes,
    bufferMinutes: company.bufferMinutes,
    minNoticeHours: company.minNoticeHours,
    horizonDays: company.bookingHorizonDays,
    workerIds: workers,
    busy,
    base: company.baseLat != null && company.baseLng != null ? { lat: company.baseLat, lng: company.baseLng } : null,
    target,
  };
}

/** Real booking: database + Google/Outlook busy time + the slot engine. */
export const bookingService: BookingService = {
  async findSlots(company, req) {
    const from = new Date();
    const to = DateTime.now().plus({ days: company.bookingHorizonDays + 1 }).toJSDate();
    // Pull the latest busy time from connected calendars (bounded, best effort).
    await Promise.race([refreshBusyForCompany(company.id).catch(() => undefined), new Promise((r) => setTimeout(r, 2500))]);
    const { workers, busy } = await loadAvailability(company.id, from, to);
    if (!workers.length) return [];
    const target = req.lat != null && req.lng != null ? { lat: req.lat, lng: req.lng } : null;
    return findSlots({
      ...engineInput(company, workers.map((w) => w.userId), busy, target, req.minutes),
      earliest: req.earliest,
      latest: req.latest,
      partOfDay: req.partOfDay,
    }).map((c): Slot => ({ userId: c.userId, start: c.start, end: c.end, travelMinutes: c.travelMinutes }));
  },

  async book(company, slot, d) {
    // Re-check this exact slot right before booking (someone may have booked meanwhile).
    const { workers, busy } = await loadAvailability(company.id, new Date(slot.start.getTime() - 86400_000), new Date(slot.end.getTime() + 86400_000));
    const minutes = Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
    const target = d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null;
    const still = findSlots({
      ...engineInput(company, [slot.userId], busy, target, minutes),
      earliest: slot.start,
      latest: slot.start,
      stepMinutes: 15,
      maxResults: 1,
    });
    if (!still.length || still[0].start.getTime() !== slot.start.getTime()) throw new Error("slot_conflict");
    try {
      const appt = await createAppointment({
        companyId: company.id,
        actor: { userId: null, kind: "ai" },
        leadId: d.leadId,
        callId: d.callId,
        assignedUserId: slot.userId,
        title: d.title,
        startsAt: slot.start,
        endsAt: slot.end,
        address: d.address,
        lat: d.lat,
        lng: d.lng,
        customerName: d.name,
        customerPhone: d.phone,
        notes: d.notes,
      });
      return { id: appt.id, startsAt: appt.startsAt, assigneeName: workers.find((w) => w.userId === slot.userId)?.name ?? null };
    } catch (e) {
      if (e instanceof SlotConflictError) throw new Error("slot_conflict");
      throw e;
    }
  },

  inServiceArea(company: Company, geo) {
    return inServiceArea(company, geo);
  },
};

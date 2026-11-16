import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { estimateTravelMinutes, findSlots, inServiceArea, type Busy, type FindSlotsInput } from "@/lib/booking/engine";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/db/schema";

const TZ = "Europe/Oslo";
const OSLO_BASE = { lat: 59.9104, lng: 10.7445 }; // Kirkegata, sentrum
const GRUNERLOKKA = { lat: 59.9283, lng: 10.7301 };
const BAERUM = { lat: 59.9184, lng: 10.5893 };
const LILLESTROM = { lat: 59.9559, lng: 11.0504 };
const LILLESTROM_2 = { lat: 59.957, lng: 11.052 };

const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const local = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat("ccc HH:mm");

const base = (over: Partial<FindSlotsInput> = {}): FindSlotsInput => ({
  now: at("2026-11-16T10:00"), // Monday
  tz: TZ,
  hours: DEFAULT_BUSINESS_HOURS,
  minutes: 45,
  bufferMinutes: 15,
  minNoticeHours: 3,
  horizonDays: 14,
  workerIds: ["kari"],
  busy: [],
  base: OSLO_BASE,
  target: GRUNERLOKKA,
  ...over,
});

const appt = (userId: string, start: string, minutes: number, location: { lat: number; lng: number } | null): Busy => ({
  userId,
  start: at(start),
  end: DateTime.fromJSDate(at(start)).plus({ minutes }).toJSDate(),
  location,
  kind: "appointment",
});

describe("travel time estimate", () => {
  it("gives sensible Oslo-area driving times", () => {
    expect(estimateTravelMinutes(OSLO_BASE, GRUNERLOKKA)).toBe(15);
    expect(estimateTravelMinutes(OSLO_BASE, BAERUM)).toBe(25);
    expect(estimateTravelMinutes(OSLO_BASE, LILLESTROM)).toBe(40);
    expect(estimateTravelMinutes(LILLESTROM, LILLESTROM_2)).toBe(0);
    expect(estimateTravelMinutes(null, GRUNERLOKKA)).toBe(20);
  });
});

describe("findSlots", () => {
  it("respects minimum notice and offers different days", () => {
    const s = findSlots(base());
    expect(s.map((x) => local(x.start))).toEqual(["Mon 13:00", "Tue 07:30", "Wed 07:30"]);
    // First job of the day: can't start before driving there from the base (07:00 + 15 min).
    expect(s[1].travelMinutes).toBe(15);
  });

  it("never overlaps a befaring and leaves time to drive between jobs", () => {
    const s = findSlots(base({ busy: [appt("kari", "2026-11-16T13:00", 45, LILLESTROM)], maxResults: 20 }));
    // 13:45 + 15 min buffer + ~40 min drive back from Lillestrøm = 14:40; a 45-min visit would end after 15:30.
    expect(s.some((x) => DateTime.fromJSDate(x.start).setZone(TZ).toISODate() === "2026-11-16")).toBe(false);
  });

  it("checks there is time to reach the *next* job too", () => {
    const busy = [appt("kari", "2026-11-17T10:00", 45, LILLESTROM)];
    const s = findSlots(base({ target: BAERUM, busy, maxResults: 50, earliest: at("2026-11-17T00:00"), latest: at("2026-11-17T23:59") }));
    const times = s.map((x) => local(x.start));
    // 08:30 would end 09:15 + 15 buffer + ~55 min Bærum→Lillestrøm = 10:25 > 10:00.
    expect(times).not.toContain("Tue 08:30");
  });

  it("clusters jobs: prefers the day you're already in the area", () => {
    const busy = [appt("kari", "2026-11-17T09:00", 45, LILLESTROM)];
    const [best] = findSlots(base({ target: LILLESTROM_2, busy, maxResults: 1 }));
    // Right before or right after the existing job in Lillestrøm: zero extra driving.
    expect(["Tue 08:00", "Tue 10:00"]).toContain(local(best.start));
    expect(best.detourMinutes).toBe(0);
    // Without that job, a Lillestrøm visit costs ~40 min of driving from the base.
    const [alone] = findSlots(base({ target: LILLESTROM_2, maxResults: 1 }));
    expect(alone.detourMinutes).toBe(40);
  });

  it("treats Google/Outlook busy time as blocked (with buffer)", () => {
    const external: Busy = { userId: "kari", start: at("2026-11-17T07:00"), end: at("2026-11-17T12:00"), kind: "external" };
    const s = findSlots(base({ busy: [external], partOfDay: "morning", earliest: at("2026-11-17T00:00"), maxResults: 2 }));
    expect(s.map((x) => local(x.start))).toEqual(["Wed 07:30", "Thu 07:30"]);
  });

  it("filters by part of day and date window", () => {
    const s = findSlots(base({ partOfDay: "afternoon", earliest: at("2026-11-18T00:00"), latest: at("2026-11-18T23:59"), maxResults: 3 }));
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) {
      const d = DateTime.fromJSDate(x.start).setZone(TZ);
      expect(d.weekday).toBe(3);
      expect(d.hour).toBeGreaterThanOrEqual(12);
    }
  });

  it("assigns the colleague who is free", () => {
    const busy = [{ userId: "kari", start: at("2026-11-16T12:00"), end: at("2026-11-16T16:00"), kind: "external" as const }];
    const s = findSlots(base({ workerIds: ["kari", "ola"], busy, maxResults: 1, latest: at("2026-11-16T23:59") }));
    expect(s[0].userId).toBe("ola");
    expect(local(s[0].start)).toBe("Mon 13:00");
  });

  it("stays inside business hours and the booking horizon", () => {
    const s = findSlots(base({ horizonDays: 1, maxResults: 50 }));
    for (const x of s) {
      const d = DateTime.fromJSDate(x.start).setZone(TZ);
      expect([1, 2]).toContain(d.weekday);
      expect(d.toFormat("HH:mm") >= "07:00").toBe(true);
      expect(DateTime.fromJSDate(x.end).setZone(TZ).toFormat("HH:mm") <= "15:30").toBe(true);
    }
    // Weekend: nothing on Saturday/Sunday.
    const weekend = findSlots(base({ now: at("2026-11-20T15:00"), horizonDays: 2, maxResults: 50 }));
    expect(weekend).toHaveLength(0);
  });

  it("handles the switch to summer time", () => {
    const s = findSlots(base({ now: at("2026-03-27T10:00"), earliest: at("2026-03-30T00:00"), maxResults: 1 }));
    expect(local(s[0].start)).toBe("Mon 07:30");
    expect(s[0].start.toISOString()).toBe("2026-03-30T05:30:00.000Z");
  });
});

describe("service area", () => {
  const company = { servicePostcodes: [] as string[], serviceRadiusKm: 30, baseLat: OSLO_BASE.lat, baseLng: OSLO_BASE.lng };
  it("uses the radius around the base", () => {
    expect(inServiceArea(company, { ...LILLESTROM, postcode: "2000" })).toBe(true);
    expect(inServiceArea(company, { lat: 60.79, lng: 11.07, postcode: "2317" })).toBe(false); // Hamar
    expect(inServiceArea(company, null)).toBeNull();
  });
  it("uses postcode prefixes when given", () => {
    const c = { ...company, servicePostcodes: ["01", "02", "0450"] };
    expect(inServiceArea(c, { ...GRUNERLOKKA, postcode: "0168" })).toBe(true);
    expect(inServiceArea(c, { ...GRUNERLOKKA, postcode: "0450" })).toBe(true);
    expect(inServiceArea(c, { ...LILLESTROM, postcode: "2000" })).toBe(false);
  });
});

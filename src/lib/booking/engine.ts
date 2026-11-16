/**
 * Befaring slot finder — a pure function, so it is fast and fully unit-tested.
 *
 * Rules:
 *  - only inside business hours, never earlier than `minNoticeHours`, never
 *    further ahead than `horizonDays`;
 *  - never overlapping the worker's befaringer or external calendar events,
 *    with `bufferMinutes` around each;
 *  - there must be time to drive from the previous job (or the base, for the
 *    first job of the day) and on to the next one;
 *  - among feasible slots, prefer ones that add little driving (jobs in the
 *    same area end up on the same day) and that come soon.
 */
import { DateTime } from "luxon";
import type { BusinessHours } from "../db/schema";

export type LatLng = { lat: number; lng: number };
export type Busy = {
  userId: string;
  start: Date;
  end: Date;
  /** Where the worker will be (befaringer have a location; external events usually don't). */
  location?: LatLng | null;
  kind: "appointment" | "external";
};
export type Candidate = { userId: string; start: Date; end: Date; travelMinutes: number; detourMinutes: number };

export type FindSlotsInput = {
  now: Date;
  tz: string;
  hours: BusinessHours;
  minutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  horizonDays: number;
  workerIds: string[];
  busy: Busy[];
  base: LatLng | null;
  target: LatLng | null;
  earliest?: Date;
  latest?: Date;
  partOfDay?: "morning" | "afternoon" | "any";
  stepMinutes?: number;
  maxResults?: number;
  travel?: (a: LatLng | null, b: LatLng | null) => number;
};

const UNKNOWN_TRAVEL_MIN = 20;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Driving-time estimate from straight-line distance (no API key needed):
 * roads are ~35 % longer than a straight line; town traffic is slower than
 * motorways; plus 5 minutes to park and walk. Rounded up to 5 minutes.
 */
export function estimateTravelMinutes(a: LatLng | null, b: LatLng | null): number {
  if (!a || !b) return UNKNOWN_TRAVEL_MIN;
  const km = haversineKm(a, b) * 1.35;
  if (km < 0.3) return 0;
  const speed = km < 10 ? 25 : km < 40 ? 45 : 65;
  return Math.ceil(((km / speed) * 60 + 5) / 5) * 5;
}

const ms = (min: number) => min * 60_000;

export function findSlots(input: FindSlotsInput): Candidate[] {
  const travel = input.travel ?? estimateTravelMinutes;
  const step = input.stepMinutes ?? 30;
  const maxResults = input.maxResults ?? 3;
  const tz = input.tz;
  const now = DateTime.fromJSDate(input.now).setZone(tz);
  const notBefore = Math.max(input.now.getTime() + ms(input.minNoticeHours * 60), input.earliest?.getTime() ?? 0);
  const horizonEnd = now.plus({ days: input.horizonDays }).endOf("day").toMillis();
  const notAfter = Math.min(horizonEnd, input.latest?.getTime() ?? Infinity);

  // Each worker's commitments, sorted.
  const byWorker = new Map<string, Busy[]>();
  for (const w of input.workerIds) byWorker.set(w, []);
  for (const b of input.busy) byWorker.get(b.userId)?.push(b);
  for (const list of byWorker.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());

  const candidates: (Candidate & { dayIndex: number })[] = [];
  for (let dayIndex = 0; dayIndex <= input.horizonDays; dayIndex++) {
    const day = now.startOf("day").plus({ days: dayIndex });
    if (day.toMillis() > notAfter) break;
    const ranges = input.hours[String(day.weekday) as keyof BusinessHours] ?? [];
    for (const range of ranges) {
      const [sh, sm] = range.start.split(":").map(Number);
      const [eh, em] = range.end.split(":").map(Number);
      const rangeStart = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const rangeEnd = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
      for (let t = rangeStart; t.plus({ minutes: input.minutes }) <= rangeEnd; t = t.plus({ minutes: step })) {
        const start = t.toMillis();
        const end = t.plus({ minutes: input.minutes }).toMillis();
        if (start < notBefore || start > notAfter) continue;
        if (input.partOfDay === "morning" && t.hour >= 12) continue;
        if (input.partOfDay === "afternoon" && t.hour < 12) continue;

        let best: Candidate | null = null;
        for (const userId of input.workerIds) {
          const c = evaluate(userId, start, end, rangeStart.toMillis(), byWorker.get(userId)!, input, travel, day);
          if (c && (!best || c.detourMinutes < best.detourMinutes)) best = c;
        }
        if (best) candidates.push({ ...best, dayIndex });
      }
    }
  }

  // Score: driving detour matters most; each extra day of waiting "costs" 30 minutes.
  const score = (c: (typeof candidates)[number]) => c.detourMinutes + c.dayIndex * 30 + (c.start.getTime() - notBefore) / ms(60) / 100;
  candidates.sort((a, b) => score(a) - score(b));

  // Offer variety: different days first, then other times at least 2 hours apart.
  const picked: Candidate[] = [];
  const days = new Set<number>();
  for (const c of candidates) {
    if (picked.length >= maxResults) break;
    if (!days.has(c.dayIndex)) {
      picked.push(c);
      days.add(c.dayIndex);
    }
  }
  for (const c of candidates) {
    if (picked.length >= maxResults) break;
    if (!picked.includes(c) && picked.every((p) => Math.abs(p.start.getTime() - c.start.getTime()) >= ms(120))) picked.push(c);
  }
  return picked
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ userId, start, end, travelMinutes, detourMinutes }) => ({ userId, start, end, travelMinutes, detourMinutes }));
}

function evaluate(
  userId: string,
  start: number,
  end: number,
  dayWorkStart: number,
  commitments: Busy[],
  input: FindSlotsInput,
  travel: (a: LatLng | null, b: LatLng | null) => number,
  day: DateTime,
): Candidate | null {
  const buf = ms(input.bufferMinutes);
  const dayStart = day.toMillis();
  const dayEnd = day.endOf("day").toMillis();
  let prev: Busy | null = null;
  let next: Busy | null = null;
  for (const b of commitments) {
    const bs = b.start.getTime();
    const be = b.end.getTime();
    // Hard overlap (with buffer) with anything is a no-go.
    if (bs < end + buf && be > start - buf) return null;
    if (be <= start && be >= dayStart && b.kind === "appointment" && (!prev || be > prev.end.getTime())) prev = b;
    if (bs >= end && bs <= dayEnd && b.kind === "appointment" && !next) next = b;
  }
  const from = prev ? (prev.location ?? null) : input.base;
  const travelIn = prev || input.base ? travel(from, input.target) : 0;
  const earliestArrival = (prev ? prev.end.getTime() + buf : dayWorkStart) + ms(travelIn);
  if (start < earliestArrival) return null;
  let travelOut = 0;
  if (next) {
    travelOut = travel(input.target, next.location ?? null);
    if (end + buf + ms(travelOut) > next.start.getTime()) return null;
  }
  // Extra driving this befaring adds compared with not having it.
  const via = from && next?.location ? travel(from, next.location) : 0;
  const detour = Math.max(0, travelIn + (next ? travelOut : 0) - (next ? via : 0));
  return { userId, start: new Date(start), end: new Date(end), travelMinutes: travelIn, detourMinutes: detour };
}

/** Is an address inside the company's area (postcode prefixes win over radius)? */
export function inServiceArea(
  company: { servicePostcodes: string[]; serviceRadiusKm: number; baseLat: number | null; baseLng: number | null },
  place: { lat: number; lng: number; postcode?: string | null } | null,
): boolean | null {
  if (!place) return null;
  if (company.servicePostcodes.length) {
    if (!place.postcode) return null;
    return company.servicePostcodes.some((p) => place.postcode!.startsWith(p));
  }
  if (company.baseLat == null || company.baseLng == null) return null;
  return haversineKm({ lat: company.baseLat, lng: company.baseLng }, place) <= company.serviceRadiusKm;
}

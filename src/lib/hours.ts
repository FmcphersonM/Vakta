import { DateTime } from "luxon";
import type { BusinessHours, Company } from "./db/schema";

/** Is the company open at this moment (company's own time zone)? */
export function isOpenAt(hours: BusinessHours, tz: string, at: Date = new Date()): boolean {
  const dt = DateTime.fromJSDate(at).setZone(tz);
  const day = String(dt.weekday) as keyof BusinessHours;
  const hm = dt.toFormat("HH:mm");
  return (hours[day] ?? []).some((r) => r.start <= hm && hm < r.end);
}

/** May a call be transferred live to the owner right now, per the company's rules? */
export function canForwardNow(
  c: Pick<Company, "forwardNumber" | "forwardHours" | "businessHours" | "timezone">,
  at: Date = new Date(),
): boolean {
  if (!c.forwardNumber) return false;
  if (c.forwardHours === "always") return true;
  const open = isOpenAt(c.businessHours, c.timezone, at);
  return c.forwardHours === "business_hours" ? open : !open;
}

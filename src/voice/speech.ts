import { DateTime } from "luxon";

const NB_HOURS = ["tolv", "ett", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni", "ti", "elleve"];
const nbHour = (h: number) => NB_HOURS[((h % 12) + 12) % 12];

/** How a Norwegian says a time on the phone: 09:30 → "klokken halv ti". */
export function spokenTimeNb(hour: number, minute: number): string {
  const next = hour + 1;
  switch (minute) {
    case 0: return `klokken ${nbHour(hour)}`;
    case 5: return `fem over ${nbHour(hour)}`;
    case 10: return `ti over ${nbHour(hour)}`;
    case 15: return `kvart over ${nbHour(hour)}`;
    case 20: return `ti på halv ${nbHour(next)}`;
    case 25: return `fem på halv ${nbHour(next)}`;
    case 30: return `klokken halv ${nbHour(next)}`;
    case 35: return `fem over halv ${nbHour(next)}`;
    case 40: return `ti over halv ${nbHour(next)}`;
    case 45: return `kvart på ${nbHour(next)}`;
    case 50: return `ti på ${nbHour(next)}`;
    case 55: return `fem på ${nbHour(next)}`;
    default: return `klokken ${hour}.${String(minute).padStart(2, "0")}`;
  }
}

export function spokenTimeEn(hour: number, minute: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? "am" : "pm";
  if (minute === 0) return `${h12} ${ampm}`;
  if (minute === 30) return `half past ${h12} ${ampm}`;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** "i morgen klokken halv ti" / "torsdag 20. november klokken ett" */
export function spokenSlot(start: Date, tz: string, lang: "nb" | "en", now: Date = new Date()): string {
  const dt = DateTime.fromJSDate(start).setZone(tz);
  const today = DateTime.fromJSDate(now).setZone(tz).startOf("day");
  const days = Math.round(dt.startOf("day").diff(today, "days").days);
  if (lang === "en") {
    const day = days === 0 ? "today" : days === 1 ? "tomorrow" : dt.setLocale("en-GB").toFormat("cccc d MMMM");
    return `${day} at ${spokenTimeEn(dt.hour, dt.minute)}`;
  }
  const local = dt.setLocale("nb");
  const day = days === 0 ? "i dag" : days === 1 ? "i morgen" : days < 7 ? `på ${local.toFormat("cccc")}` : local.toFormat("cccc d. MMMM");
  return `${day} ${spokenTimeNb(dt.hour, dt.minute)}`;
}

/** Rough speaking time, used to let a goodbye finish before hanging up. */
export function speechMillis(text: string): number {
  return Math.min(15_000, 600 + text.length * 65);
}

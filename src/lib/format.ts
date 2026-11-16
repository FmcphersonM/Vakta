import { DateTime } from "luxon";

export const TZ = "Europe/Oslo";

function dt(d: Date | string, tz = TZ, locale = "nb") {
  return (typeof d === "string" ? DateTime.fromISO(d) : DateTime.fromJSDate(d)).setZone(tz).setLocale(locale === "en" ? "en-GB" : "nb");
}

export const fmt = {
  time: (d: Date | string, locale = "nb", tz = TZ) => dt(d, tz, locale).toFormat("HH:mm"),
  /** "tirsdag 18. november" */
  dayLong: (d: Date | string, locale = "nb", tz = TZ) =>
    dt(d, tz, locale).toFormat(locale === "en" ? "cccc d MMMM" : "cccc d. MMMM"),
  /** "tir. 18. nov." */
  dayShort: (d: Date | string, locale = "nb", tz = TZ) =>
    dt(d, tz, locale).toFormat(locale === "en" ? "ccc d MMM" : "ccc d. MMM"),
  dateTime: (d: Date | string, locale = "nb", tz = TZ) =>
    dt(d, tz, locale).toFormat(locale === "en" ? "d MMM yyyy, HH:mm" : "d. MMM yyyy 'kl.' HH:mm"),
  date: (d: Date | string, locale = "nb", tz = TZ) =>
    dt(d, tz, locale).toFormat(locale === "en" ? "d MMM yyyy" : "d. MMM yyyy"),
  relative: (d: Date | string, locale = "nb") =>
    dt(d, TZ, locale).toRelative({ locale: locale === "en" ? "en" : "nb" }) ?? "",
  duration: (seconds: number | null | undefined) => {
    if (!seconds && seconds !== 0) return "–";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
  },
  /** +4791234567 → "912 34 567" (Norwegian grouping) */
  phone: (e164: string | null | undefined) => {
    if (!e164) return "";
    const m = e164.match(/^\+47(\d{8})$/);
    if (!m) return e164;
    const n = m[1];
    return /^[49]/.test(n) ? `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5)}` : `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
  },
  nok: (n: number | null | undefined, locale = "nb") =>
    n == null ? "" : new Intl.NumberFormat(locale === "en" ? "en-GB" : "nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n),
};

/** Normalise Norwegian phone input to E.164 (+47XXXXXXXX). Returns null if invalid. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^\d{8}$/.test(s)) s = `+47${s}`;
  if (/^47\d{8}$/.test(s)) s = `+${s}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

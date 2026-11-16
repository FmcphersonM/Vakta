import { DateTime } from "luxon";
import { fmt } from "../format";

type Base = { companyName: string; companyPhone: string | null; locale: "nb" | "en"; tz: string };

function when(d: Date, b: Base) {
  const dt = DateTime.fromJSDate(d).setZone(b.tz).setLocale(b.locale === "en" ? "en-GB" : "nb");
  return b.locale === "en" ? dt.toFormat("cccc d MMMM 'at' HH:mm") : dt.toFormat("cccc d. MMMM 'kl.' HH:mm");
}
function contact(b: Base) {
  if (!b.companyPhone) return "";
  return b.locale === "en" ? ` Questions? Call ${fmt.phone(b.companyPhone)}.` : ` Spørsmål? Ring ${fmt.phone(b.companyPhone)}.`;
}

export const sms = {
  bookingConfirmation: (b: Base & { name: string | null; start: Date; address: string | null }) =>
    b.locale === "en"
      ? `Hi${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Your site visit with ${b.companyName} is confirmed for ${when(b.start, b)}${b.address ? `, ${b.address}` : ""}.${contact(b)}`
      : `Hei${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Befaring hos ${b.companyName} er bekreftet ${when(b.start, b)}${b.address ? `, ${b.address}` : ""}.${contact(b)}`,
  rescheduled: (b: Base & { name: string | null; start: Date }) =>
    b.locale === "en"
      ? `Hi${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Your site visit with ${b.companyName} has been moved to ${when(b.start, b)}.${contact(b)}`
      : `Hei${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Befaringen hos ${b.companyName} er flyttet til ${when(b.start, b)}.${contact(b)}`,
  reminder: (b: Base & { name: string | null; start: Date; address: string | null }) =>
    b.locale === "en"
      ? `Reminder: site visit from ${b.companyName} ${when(b.start, b)}${b.address ? `, ${b.address}` : ""}.${contact(b)}`
      : `Påminnelse: befaring fra ${b.companyName} ${when(b.start, b)}${b.address ? `, ${b.address}` : ""}.${contact(b)}`,
  cancelled: (b: Base & { name: string | null; start: Date }) =>
    b.locale === "en"
      ? `Hi${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Your site visit with ${b.companyName} on ${when(b.start, b)} has been cancelled.${contact(b)}`
      : `Hei${b.name ? ` ${b.name.split(" ")[0]}` : ""}! Befaringen hos ${b.companyName} ${when(b.start, b)} er avlyst.${contact(b)}`,
  ownerBooked: (b: Base & { name: string | null; phone: string | null; start: Date; address: string | null; job: string | null; assignee: string | null }) =>
    `${b.locale === "en" ? "New site visit" : "Ny befaring"}: ${when(b.start, b)}${b.assignee ? ` (${b.assignee})` : ""}. ${[b.name, fmt.phone(b.phone), b.address, b.job].filter(Boolean).join(", ")}`,
  ownerLead: (b: Base & { name: string | null; phone: string | null; summary: string }) =>
    `${b.locale === "en" ? "New lead" : "Ny henvendelse"}: ${[b.name, fmt.phone(b.phone)].filter(Boolean).join(", ")}. ${b.summary}`.slice(0, 600),
  ownerEmergency: (b: Base & { name: string | null; phone: string | null; summary: string }) =>
    `${b.locale === "en" ? "EMERGENCY call" : "AKUTT samtale"}: ${[b.name, fmt.phone(b.phone)].filter(Boolean).join(", ")}. ${b.summary} ${b.locale === "en" ? "Call back now." : "Ring tilbake nå."}`.slice(0, 600),
  ownerMissed: (b: Base & { phone: string | null }) =>
    b.locale === "en"
      ? `Dropped call from ${fmt.phone(b.phone) || "hidden number"} – the caller hung up before giving details.`
      : `Avbrutt samtale fra ${fmt.phone(b.phone) || "skjult nummer"} – innringer la på før vi fikk detaljer.`,
};

import type { Company } from "./db/schema";

type G = Pick<Company, "name" | "recordingEnabled" | "greetingText" | "locale">;

/**
 * The fixed, non-removable opening. GDPR/transparency: callers must know they
 * talk to an AI and whether the call is recorded, before they share anything.
 */
export function disclosure(c: G, lang: "nb" | "en" = c.locale === "en" ? "en" : "nb") {
  if (lang === "en") {
    return `Hi, you've reached ${c.name}. I'm an AI assistant${c.recordingEnabled ? ", and this call is recorded" : ""}.`;
  }
  return `Hei, du har kommet til ${c.name}. Jeg er en AI-assistent${c.recordingEnabled ? ", og samtalen blir tatt opp" : ""}.`;
}

export function fullGreeting(c: G) {
  const custom = c.greetingText.trim() || (c.locale === "en" ? "How can I help you?" : "Hva kan jeg hjelpe deg med?");
  return `${disclosure(c)} ${custom}`;
}

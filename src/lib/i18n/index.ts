import { nb, type Dict } from "./nb";
import { en } from "./en";

export type Locale = "nb" | "en";
export const LOCALES: Locale[] = ["nb", "en"];
export const LOCALE_COOKIE = "vakta_locale";

export function dict(locale: string | null | undefined): Dict {
  return locale === "en" ? en : nb;
}

export function asLocale(v: string | null | undefined): Locale {
  return v === "en" ? "en" : "nb";
}

export type { Dict };

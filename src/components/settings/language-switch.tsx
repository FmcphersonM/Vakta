"use client";

import { useTransition } from "react";
import { setMyLocale } from "@/app/(app)/_actions/account";
import type { Locale } from "@/lib/i18n";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const [pending, start] = useTransition();
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm" role="group" aria-label="Språk / Language">
      {(["nb", "en"] as const).map((l) => (
        <button
          key={l}
          disabled={pending}
          aria-pressed={locale === l}
          onClick={() => start(() => setMyLocale(l))}
          className={`rounded-lg px-2.5 py-1 font-medium ${locale === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
        >
          {l === "nb" ? "Norsk" : "English"}
        </button>
      ))}
    </div>
  );
}

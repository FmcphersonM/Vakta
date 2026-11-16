import Link from "next/link";
import {
  Building2, Clock, Wrench, Bot, PhoneForwarded, Users, CalendarSync, Phone, CreditCard, ShieldCheck, Lock, History, ChevronRight, LogOut,
} from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { Card, buttonClass } from "@/components/ui";
import { logoutAction } from "@/app/(auth)/actions";
import { LanguageSwitch } from "@/components/settings/language-switch";

export const metadata = { title: "Innstillinger" };

const SECTIONS = [
  ["business", Building2], ["hours", Clock], ["services", Wrench], ["agent", Bot], ["forwarding", PhoneForwarded], ["phone", Phone],
  ["calendar", CalendarSync], ["team", Users], ["billing", CreditCard], ["security", ShieldCheck], ["privacy", Lock], ["audit", History],
] as const;

export default async function SettingsIndex() {
  const { t, user, locale } = await requireCompany();
  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight text-slate-900">{t.settings.title}</h1>
      <Card>
        <ul className="divide-y divide-slate-100">
          {SECTIONS.map(([key, Icon]) => (
            <li key={key}>
              <Link href={`/settings/${key}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 sm:px-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{t.settings.sections[key]}</span>
                  <span className="block truncate text-sm text-slate-500">{t.settings.sectionHints[key]}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{user.name}</p>
          <p className="truncate text-sm text-slate-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch locale={locale} />
          <form action={logoutAction}>
            <button className={buttonClass("secondary", "sm")}>
              <LogOut className="h-4 w-4" aria-hidden /> {t.nav.logout}
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}

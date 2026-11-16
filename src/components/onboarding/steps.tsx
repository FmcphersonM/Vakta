"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Copy, Phone, Sparkles } from "lucide-react";
import { Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { HoursFields } from "@/components/settings/forms";
import { dict, type Locale } from "@/lib/i18n";
import type { BusinessHours } from "@/lib/db/schema";
import { fmt } from "@/lib/format";
import { forwardingCodes } from "@/lib/telephony/forwarding-codes";
import { finishOnboarding, saveBusinessStep, saveHoursStep, savePhoneStep, saveServicesStep } from "@/app/onboarding/actions";

function Next({ t }: { t: ReturnType<typeof dict> }) {
  return (
    <SubmitButton size="lg" className="w-full sm:w-auto" pendingText={t.common.saving}>
      {t.common.next}
    </SubmitButton>
  );
}

export function BusinessStep({ locale, c }: { locale: Locale; c: { name: string; orgNumber: string | null; baseAddress: string | null; serviceRadiusKm: number } }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveBusinessStep, null);
  return (
    <form action={action} className="space-y-4">
      <Field label={t.settings.business.name} htmlFor="name">
        <Input id="name" name="name" defaultValue={c.name} required />
      </Field>
      <Field label={t.settings.business.baseAddress} htmlFor="baseAddress" hint={t.settings.business.baseAddressHint}>
        <Input id="baseAddress" name="baseAddress" defaultValue={c.baseAddress ?? ""} placeholder="Storgata 1, 0155 Oslo" required autoComplete="street-address" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.settings.business.radius} htmlFor="serviceRadiusKm">
          <Select id="serviceRadiusKm" name="serviceRadiusKm" defaultValue={String(c.serviceRadiusKm)}>
            {[10, 20, 30, 40, 60, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} km
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t.settings.business.orgNumber} (${t.common.optional})`} htmlFor="orgNumber">
          <Input id="orgNumber" name="orgNumber" defaultValue={c.orgNumber ?? ""} inputMode="numeric" />
        </Field>
      </div>
      <FormMessage state={state} />
      <Next t={t} />
    </form>
  );
}

export function ServicesStep({ locale, jobTypes, befaringMinutes }: { locale: Locale; jobTypes: { id: string; name: string; active: boolean }[]; befaringMinutes: number }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveServicesStep, null);
  return (
    <form action={action} className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">{t.settings.sections.services}</legend>
        {jobTypes.map((j) => (
          <label key={j.id} className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3 py-3 ring-1 ring-slate-200 has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-300">
            <input type="checkbox" name="keep" value={j.id} defaultChecked={j.active} className="h-5 w-5 accent-brand-700" />
            <span className="text-sm font-medium text-slate-800">{j.name}</span>
          </label>
        ))}
      </fieldset>
      <Field label={`${t.settings.services.addService} (${t.common.optional})`} htmlFor="extra" hint={t.onboarding.extraHint}>
        <Textarea id="extra" name="extra" rows={2} />
      </Field>
      <Field label={t.settings.hours.befaringLength} htmlFor="befaringMinutes">
        <Select id="befaringMinutes" name="befaringMinutes" defaultValue={String(befaringMinutes)}>
          {[30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {t.common.minutes(m)}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage state={state} />
      <Next t={t} />
    </form>
  );
}

export function HoursStep({ locale, hours }: { locale: Locale; hours: BusinessHours }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveHoursStep, null);
  return (
    <form action={action} className="space-y-4">
      <HoursFields hours={hours} t={t} />
      <FormMessage state={state} />
      <Next t={t} />
    </form>
  );
}

export function PhoneStep({ locale, mobile }: { locale: Locale; mobile: string | null }) {
  const t = dict(locale);
  const [state, action] = useActionState(savePhoneStep, null);
  return (
    <form action={action} className="space-y-4">
      <Field label={t.onboarding.forwardMobile} htmlFor="mobile">
        <Input id="mobile" name="mobile" type="tel" inputMode="tel" defaultValue={mobile ? fmt.phone(mobile) : ""} placeholder="912 34 567" required autoComplete="tel" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText={t.common.loading}>
        <Phone className="h-4 w-4" aria-hidden /> {t.settings.phone.getNumber}
      </SubmitButton>
    </form>
  );
}

export function TestStep({ locale, number, simulated }: { locale: Locale; number: string; simulated: boolean }) {
  const t = dict(locale);
  const code = forwardingCodes(number).allConditional;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-200">
        <p className="text-sm text-brand-900">{t.settings.phone.yourNumber}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{fmt.phone(number)}</p>
        {simulated && <p className="mt-1 text-sm text-amber-800">{t.settings.phone.simulated}</p>}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-800">{t.settings.phone.modeForward}</p>
        <p className="mt-1 text-sm text-slate-600">{t.settings.phone.codesIntro}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-base text-slate-900">{code}</code>
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            onClick={() => {
              void navigator.clipboard.writeText(code);
              setCopied(true);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden /> {copied ? t.common.copied : t.common.copy}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {!simulated && (
          <a href={`tel:${number}`} className={buttonClass("secondary", "lg")}>
            <Phone className="h-4 w-4" aria-hidden /> {t.settings.phone.testCall}
          </a>
        )}
        <Link href="/test-agent" className={buttonClass("secondary", "lg")}>
          <Sparkles className="h-4 w-4" aria-hidden /> {t.today.tryAgentCta}
        </Link>
      </div>
      <form action={finishOnboarding}>
        <SubmitButton size="lg" className="w-full sm:w-auto">
          {t.onboarding.finish}
        </SubmitButton>
      </form>
    </div>
  );
}

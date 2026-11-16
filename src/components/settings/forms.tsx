"use client";

import { useActionState, useState } from "react";
import { Copy, Lock, Trash2 } from "lucide-react";
import { Card, Field, Input, Select, Textarea, Toggle, buttonClass } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/ui/form";
import { dict, type Locale } from "@/lib/i18n";
import type { BusinessHours, Company, JobType } from "@/lib/db/schema";
import {
  deleteJobType,
  inviteMember,
  saveAgent,
  saveBusiness,
  saveForwarding,
  saveHours,
  saveJobType,
} from "@/app/(app)/_actions/settings";
import { disclosure } from "@/lib/greeting";
import { fmt } from "@/lib/format";

type C = Pick<
  Company,
  | "name" | "orgNumber" | "phone" | "email" | "baseAddress" | "serviceRadiusKm" | "servicePostcodes" | "trade"
  | "businessHours" | "befaringMinutes" | "bufferMinutes" | "minNoticeHours" | "bookingHorizonDays"
  | "greetingText" | "agentInstructions" | "recordingEnabled" | "recordingRetentionDays" | "transcriptRetentionDays" | "locale" | "smsSenderName"
  | "forwardEmergencies" | "forwardOnRequest" | "forwardNumber" | "forwardHours" | "vipNumbers" | "blockedNumbers" | "notifyNumbers" | "notifyOn"
>;

function Section({ children }: { children: React.ReactNode }) {
  return <Card className="space-y-4 p-4 sm:p-6">{children}</Card>;
}

function Save({ state, t }: { state: ActionState; t: ReturnType<typeof dict> }) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
      <SubmitButton pendingText={t.common.saving}>{t.common.save}</SubmitButton>
      <div className="flex-1">
        <FormMessage state={state} />
      </div>
    </div>
  );
}

export function BusinessForm({ c, locale }: { c: C; locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveBusiness, null);
  return (
    <form action={action}>
      <Section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.settings.business.name} htmlFor="name">
            <Input id="name" name="name" defaultValue={c.name} required />
          </Field>
          <Field label={t.auth.trade} htmlFor="trade">
            <Select id="trade" name="trade" defaultValue={c.trade}>
              {Object.entries(t.trades).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.business.orgNumber} htmlFor="orgNumber">
            <Input id="orgNumber" name="orgNumber" defaultValue={c.orgNumber ?? ""} inputMode="numeric" />
          </Field>
          <Field label={t.settings.business.phone} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={c.phone ? fmt.phone(c.phone) : ""} />
          </Field>
          <Field label={t.settings.business.email} htmlFor="email" className="sm:col-span-2">
            <Input id="email" name="email" type="email" defaultValue={c.email ?? ""} />
          </Field>
        </div>
        <Field label={t.settings.business.baseAddress} htmlFor="baseAddress" hint={t.settings.business.baseAddressHint}>
          <Input id="baseAddress" name="baseAddress" defaultValue={c.baseAddress ?? ""} placeholder="Storgata 1, 0155 Oslo" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.settings.business.radius} htmlFor="serviceRadiusKm">
            <Input id="serviceRadiusKm" name="serviceRadiusKm" type="number" min={1} max={500} defaultValue={c.serviceRadiusKm} />
          </Field>
          <Field label={t.settings.business.postcodes} htmlFor="servicePostcodes" hint={t.settings.business.postcodesHint}>
            <Input id="servicePostcodes" name="servicePostcodes" defaultValue={c.servicePostcodes.join(", ")} />
          </Field>
        </div>
        <Save state={state} t={t} />
      </Section>
    </form>
  );
}

export function HoursFields({ hours, t }: { hours: BusinessHours; t: ReturnType<typeof dict> }) {
  return (
    <ul className="divide-y divide-slate-100">
      {(["1", "2", "3", "4", "5", "6", "7"] as const).map((d, i) => {
        const r = hours[d]?.[0];
        return (
          <li key={d} className="flex flex-wrap items-center gap-3 py-2.5">
            <label className="flex w-32 items-center gap-2.5 text-sm font-medium text-slate-800">
              <input type="checkbox" name={`open_${d}`} defaultChecked={!!r} className="h-4 w-4 accent-brand-700" />
              {t.settings.hours.weekdays[i]}
            </label>
            <div className="flex items-center gap-2">
              <Input type="time" name={`start_${d}`} defaultValue={r?.start ?? "07:00"} aria-label={`${t.settings.hours.weekdays[i]} ${t.settings.hours.from}`} className="!w-28 !py-2" step={900} />
              <span className="text-slate-400">–</span>
              <Input type="time" name={`end_${d}`} defaultValue={r?.end ?? "15:30"} aria-label={`${t.settings.hours.weekdays[i]} ${t.settings.hours.to}`} className="!w-28 !py-2" step={900} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function HoursForm({ c, locale }: { c: C; locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveHours, null);
  return (
    <form action={action}>
      <Section>
        <HoursFields hours={c.businessHours} t={t} />
        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Field label={t.settings.hours.befaringLength} htmlFor="befaringMinutes">
            <Select id="befaringMinutes" name="befaringMinutes" defaultValue={String(c.befaringMinutes)}>
              {[30, 45, 60, 75, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {t.common.minutes(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.hours.buffer} htmlFor="bufferMinutes">
            <Select id="bufferMinutes" name="bufferMinutes" defaultValue={String(c.bufferMinutes)}>
              {[0, 10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {t.common.minutes(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.settings.hours.minNotice} htmlFor="minNoticeHours">
            <Input id="minNoticeHours" name="minNoticeHours" type="number" min={0} max={168} defaultValue={c.minNoticeHours} />
          </Field>
          <Field label={t.settings.hours.horizon} htmlFor="bookingHorizonDays">
            <Input id="bookingHorizonDays" name="bookingHorizonDays" type="number" min={1} max={120} defaultValue={c.bookingHorizonDays} />
          </Field>
        </div>
        <Save state={state} t={t} />
      </Section>
    </form>
  );
}

function JobTypeRow({ j, locale }: { j?: JobType; locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveJobType, null);
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        {j && <input type="hidden" name="id" value={j.id} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label={t.settings.services.name} htmlFor={`n-${j?.id ?? "new"}`}>
            <Input id={`n-${j?.id ?? "new"}`} name="name" defaultValue={j?.name ?? ""} required />
          </Field>
          <Field label={t.settings.services.befaringLength} htmlFor={`m-${j?.id ?? "new"}`}>
            <Select id={`m-${j?.id ?? "new"}`} name="befaringMinutes" defaultValue={j?.befaringMinutes ? String(j.befaringMinutes) : ""}>
              <option value="">{t.settings.services.defaultLength}</option>
              {[30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {t.common.minutes(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t.settings.services.description} htmlFor={`d-${j?.id ?? "new"}`}>
          <Input id={`d-${j?.id ?? "new"}`} name="description" defaultValue={j?.description ?? ""} />
        </Field>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="needsBefaring" defaultChecked={j?.needsBefaring ?? true} className="h-4 w-4 accent-brand-700" />
            {t.settings.services.needsBefaring}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={j?.active ?? true} className="h-4 w-4 accent-brand-700" />
            {t.settings.services.active}
          </label>
          <div className="ml-auto flex items-center gap-2">
            <FormMessage state={state} />
            <SubmitButton size="sm" variant={j ? "secondary" : "primary"}>
              {j ? t.common.save : t.settings.services.addService}
            </SubmitButton>
          </div>
        </div>
      </form>
      {j && (
        <form action={deleteJobType} className="mt-2 flex justify-end">
          <input type="hidden" name="id" value={j.id} />
          <button className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-700">
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t.common.delete}
          </button>
        </form>
      )}
    </Card>
  );
}

export function ServicesList({ jobTypes, locale }: { jobTypes: JobType[]; locale: Locale }) {
  return (
    <div className="space-y-3">
      {jobTypes.map((j) => (
        <JobTypeRow key={j.id} j={j} locale={locale} />
      ))}
      <JobTypeRow key={`new-${jobTypes.length}`} locale={locale} />
    </div>
  );
}

export function AgentForm({ c, locale }: { c: C; locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(saveAgent, null);
  const [greeting, setGreeting] = useState(c.greetingText);
  const [recording, setRecording] = useState(c.recordingEnabled);
  const [lang, setLang] = useState<"nb" | "en">(c.locale === "en" ? "en" : "nb");
  const fixed = disclosure({ name: c.name, recordingEnabled: recording, greetingText: greeting, locale: lang });
  return (
    <form action={action}>
      <Section>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.settings.agent.preview}</p>
          <p className="mt-1.5 text-[0.95rem] text-slate-900">
            <span className="text-slate-500">{fixed}</span> {greeting}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="h-3 w-3" aria-hidden /> {t.settings.agent.disclosure}
          </p>
        </div>
        <Field label={t.settings.agent.greeting} htmlFor="greetingText" hint={t.settings.agent.greetingHint}>
          <Input id="greetingText" name="greetingText" value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={300} required />
        </Field>
        <Field label={t.settings.agent.instructions} htmlFor="agentInstructions" hint={t.settings.agent.instructionsHint}>
          <Textarea id="agentInstructions" name="agentInstructions" defaultValue={c.agentInstructions} rows={5} maxLength={3000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.settings.agent.language} htmlFor="locale">
            <Select id="locale" name="locale" value={lang} onChange={(e) => setLang(e.target.value as "nb" | "en")}>
              <option value="nb">Norsk (bokmål)</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t.settings.agent.smsSender} htmlFor="smsSenderName" hint={t.settings.agent.smsSenderHint}>
            <Input id="smsSenderName" name="smsSenderName" defaultValue={c.smsSenderName ?? ""} maxLength={11} pattern="[A-Za-z0-9 ]{0,11}" />
          </Field>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-slate-800">{t.settings.agent.recording}</span>
              <span className="block text-xs text-slate-500">{t.settings.agent.recordingHint}</span>
            </span>
            <input type="checkbox" name="recordingEnabled" checked={recording} onChange={(e) => setRecording(e.target.checked)} className="mt-1 h-5 w-5 accent-brand-700" />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.settings.agent.retention} htmlFor="recordingRetentionDays">
            <Input id="recordingRetentionDays" name="recordingRetentionDays" type="number" min={1} max={3650} defaultValue={c.recordingRetentionDays} />
          </Field>
          <Field label={t.settings.agent.transcriptRetention} htmlFor="transcriptRetentionDays">
            <Input id="transcriptRetentionDays" name="transcriptRetentionDays" type="number" min={30} max={3650} defaultValue={c.transcriptRetentionDays} />
          </Field>
        </div>
        <Save state={state} t={t} />
      </Section>
    </form>
  );
}

export function ForwardingForm({ c, locale }: { c: C; locale: Locale }) {
  const t = dict(locale);
  const f = t.settings.forwarding;
  const [state, action] = useActionState(saveForwarding, null);
  return (
    <form action={action}>
      <Section>
        <Toggle name="forwardEmergencies" label={f.emergencies} hint={f.emergenciesHint} defaultChecked={c.forwardEmergencies} />
        <Toggle name="forwardOnRequest" label={f.onRequest} defaultChecked={c.forwardOnRequest} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={f.number} htmlFor="forwardNumber">
            <Input id="forwardNumber" name="forwardNumber" type="tel" defaultValue={c.forwardNumber ? fmt.phone(c.forwardNumber) : ""} placeholder="912 34 567" />
          </Field>
          <Field label={f.when} htmlFor="forwardHours">
            <Select id="forwardHours" name="forwardHours" defaultValue={c.forwardHours}>
              {(["always", "business_hours", "outside_business_hours"] as const).map((k) => (
                <option key={k} value={k}>
                  {f.whenOptions[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={f.vip} htmlFor="vipNumbers" hint={f.numbersHint}>
            <Textarea id="vipNumbers" name="vipNumbers" rows={2} defaultValue={c.vipNumbers.map(fmt.phone).join("\n")} />
          </Field>
          <Field label={f.blocked} htmlFor="blockedNumbers" hint={f.numbersHint}>
            <Textarea id="blockedNumbers" name="blockedNumbers" rows={2} defaultValue={c.blockedNumbers.map(fmt.phone).join("\n")} />
          </Field>
        </div>
        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Field label={f.notifyNumbers} htmlFor="notifyNumbers" hint={f.numbersHint}>
            <Textarea id="notifyNumbers" name="notifyNumbers" rows={2} defaultValue={c.notifyNumbers.map(fmt.phone).join("\n")} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium text-slate-800">{f.notifyOn}</legend>
            {(["booked", "lead", "emergency", "missed"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2.5 text-sm text-slate-700">
                <input type="checkbox" name={`notify_${k}`} defaultChecked={c.notifyOn.includes(k)} className="h-4 w-4 accent-brand-700" />
                {f.notifyOptions[k]}
              </label>
            ))}
          </fieldset>
        </div>
        <Save state={state} t={t} />
      </Section>
    </form>
  );
}

export function InviteForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(inviteMember, null);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field label={t.settings.team.inviteEmail} htmlFor="inv-email">
          <Input id="inv-email" name="email" type="email" required />
        </Field>
        <Field label={t.settings.team.role} htmlFor="inv-role">
          <Select id="inv-role" name="role" defaultValue="member">
            <option value="member">{t.settings.team.roles.member}</option>
            <option value="admin">{t.settings.team.roles.admin}</option>
          </Select>
        </Field>
        <SubmitButton>{t.settings.team.invite}</SubmitButton>
      </div>
      <FormMessage state={state} />
      {state && "link" in state && state.link && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm">
          <code className="min-w-0 flex-1 truncate px-1">{state.link}</code>
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            onClick={() => {
              void navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? t.common.copied : t.common.copy}
          </button>
        </div>
      )}
    </form>
  );
}

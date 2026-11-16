"use client";

import { useActionState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { createLead, updateLead } from "@/app/(app)/_actions/leads";
import { dict, type Locale } from "@/lib/i18n";
import type { Lead } from "@/lib/db/schema";

export function LeadForm({ locale, lead, jobTypeNames }: { locale: Locale; lead?: Lead; jobTypeNames: string[] }) {
  const t = dict(locale);
  const [state, action] = useActionState(lead ? updateLead : createLead, null);
  return (
    <form action={action} className="space-y-4">
      {lead && <input type="hidden" name="id" value={lead.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.leads.name} htmlFor="name">
          <Input id="name" name="name" defaultValue={lead?.name ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.leads.phone} htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={lead?.phone ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.leads.email} htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={lead?.email ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.leads.address} htmlFor="address">
          <Input id="address" name="address" defaultValue={lead?.address ?? ""} autoComplete="off" />
        </Field>
        <Field label={t.leads.jobType} htmlFor="jobTypeText">
          <Input id="jobTypeText" name="jobTypeText" list="jobtypes" defaultValue={lead?.jobTypeText ?? ""} />
          <datalist id="jobtypes">
            {jobTypeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Field label={t.leads.urgency} htmlFor="urgency">
          <Select id="urgency" name="urgency" defaultValue={lead?.urgency ?? "normal"}>
            {(["low", "normal", "high", "emergency"] as const).map((u) => (
              <option key={u} value={u}>
                {t.urgency[u]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t.leads.description} htmlFor="description">
        <Textarea id="description" name="description" defaultValue={lead?.description ?? ""} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.leads.preferredTimes} htmlFor="preferredTimes">
          <Input id="preferredTimes" name="preferredTimes" defaultValue={lead?.preferredTimes ?? ""} />
        </Field>
        <Field label={t.leads.value} htmlFor="valueNok">
          <Input id="valueNok" name="valueNok" inputMode="numeric" defaultValue={lead?.valueNok ?? ""} />
        </Field>
      </div>
      <Field label={t.leads.notes} htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={lead?.notes ?? ""} rows={3} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText={t.common.saving}>{t.common.save}</SubmitButton>
    </form>
  );
}

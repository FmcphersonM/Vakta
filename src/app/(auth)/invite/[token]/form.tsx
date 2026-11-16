"use client";

import { useActionState } from "react";
import { Card, Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { dict, type Locale } from "@/lib/i18n";
import { acceptInvite } from "../actions";

export function InviteAcceptForm({ locale, token, company, email, needsAccount }: { locale: Locale; token: string; company: string; email: string; needsAccount: boolean }) {
  const t = dict(locale);
  const [state, action] = useActionState(acceptInvite, null);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold text-slate-900">{t.auth.inviteTitle(company)}</h1>
      <p className="mt-1 text-sm text-slate-500">{email}</p>
      <form action={action} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        {needsAccount && (
          <>
            <Field label={t.auth.yourName} htmlFor="name">
              <Input id="name" name="name" required autoComplete="name" />
            </Field>
            <Field label={t.auth.password} htmlFor="password" hint={t.auth.passwordTooShort}>
              <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
          </>
        )}
        <FormMessage state={state} />
        <SubmitButton className="w-full" size="lg">
          {t.auth.inviteAccept}
        </SubmitButton>
      </form>
    </Card>
  );
}

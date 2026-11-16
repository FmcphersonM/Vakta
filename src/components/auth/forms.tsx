"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import {
  forgotPasswordAction,
  loginAction,
  resetPasswordAction,
  signupAction,
  verifyMfaAction,
} from "@/app/(auth)/actions";
import { dict, type Locale } from "@/lib/i18n";

function Box({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </Card>
  );
}

export function LoginForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(loginAction, null);
  return (
    <Box title={t.auth.loginTitle} subtitle={t.auth.loginSubtitle}>
      <form action={action} className="space-y-4">
        <Field label={t.auth.email} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label={t.auth.password} htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton className="w-full" size="lg">
          {t.auth.loginButton}
        </SubmitButton>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot" className="text-brand-700 hover:underline">
          {t.auth.forgot}
        </Link>
        <span className="text-slate-500">
          {t.auth.noAccount}{" "}
          <Link href="/signup" className="font-medium text-brand-700 hover:underline">
            {t.auth.createAccount}
          </Link>
        </span>
      </div>
    </Box>
  );
}

export function VerifyForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(verifyMfaAction, null);
  return (
    <Box title={t.auth.verifyTitle} subtitle={t.auth.verifySubtitle}>
      <form action={action} className="space-y-4">
        <Field label={t.auth.code} htmlFor="code">
          <Input
            id="code"
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            required
            autoFocus
            className="text-center text-lg tracking-[0.3em]"
            maxLength={12}
          />
        </Field>
        <FormMessage state={state} />
        <SubmitButton className="w-full" size="lg">
          {t.auth.verifyButton}
        </SubmitButton>
      </form>
    </Box>
  );
}

export function SignupForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(signupAction, null);
  return (
    <Box title={t.auth.signupTitle} subtitle={t.auth.signupSubtitle}>
      <form action={action} className="space-y-4">
        <Field label={t.auth.companyName} htmlFor="companyName">
          <Input id="companyName" name="companyName" required autoComplete="organization" autoFocus />
        </Field>
        <Field label={t.auth.trade} htmlFor="trade">
          <Select id="trade" name="trade" defaultValue="plumber">
            {Object.entries(t.trades).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.auth.yourName} htmlFor="name">
          <Input id="name" name="name" required autoComplete="name" />
        </Field>
        <Field label={t.auth.email} htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label={t.auth.password} htmlFor="password" hint={t.auth.passwordTooShort}>
          <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input type="checkbox" name="accept" required className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-700" />
          <span>
            {t.auth.acceptTerms}.{" "}
            <Link href="/legal/dpa" target="_blank" className="text-brand-700 underline">
              {t.auth.readDpa}
            </Link>
          </span>
        </label>
        <FormMessage state={state} />
        <SubmitButton className="w-full" size="lg">
          {t.auth.signupButton}
        </SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm text-slate-500">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          {t.auth.loginButton}
        </Link>
      </p>
    </Box>
  );
}

export function ForgotForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(forgotPasswordAction, null);
  return (
    <Box title={t.auth.forgotTitle} subtitle={t.auth.forgotSubtitle}>
      <form action={action} className="space-y-4">
        <Field label={t.auth.email} htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <FormMessage state={state} />
        <SubmitButton className="w-full" size="lg">
          {t.auth.sendLink}
        </SubmitButton>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="text-brand-700 hover:underline">
          {t.auth.loginButton}
        </Link>
      </p>
    </Box>
  );
}

export function ResetForm({ locale, token }: { locale: Locale; token: string }) {
  const t = dict(locale);
  const [state, action] = useActionState(resetPasswordAction, null);
  return (
    <Box title={t.auth.resetTitle}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label={t.auth.newPassword} htmlFor="password" hint={t.auth.passwordTooShort}>
          <Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <FormMessage state={state} />
        {state?.ok ? (
          <Link href="/login" className="block text-center font-medium text-brand-700">
            {t.auth.loginButton}
          </Link>
        ) : (
          <SubmitButton className="w-full" size="lg">
            {t.auth.resetButton}
          </SubmitButton>
        )}
      </form>
    </Box>
  );
}

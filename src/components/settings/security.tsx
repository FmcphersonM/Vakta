"use client";

import { useActionState, useState, useTransition } from "react";
import { Field, Input, buttonClass } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { dict, type Locale } from "@/lib/i18n";
import { changePassword, confirmTwoFactor, disableTwoFactor, logoutOtherDevices, startTwoFactor } from "@/app/(app)/_actions/account";

export function TwoFactorSetup({ locale, enabled }: { locale: Locale; enabled: boolean }) {
  const t = dict(locale);
  const s = t.settings.security;
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirmState, confirmAction] = useActionState(confirmTwoFactor, null);
  const [disableState, disableAction] = useActionState(disableTwoFactor, null);

  if (confirmState?.backupCodes) {
    return (
      <div className="space-y-3">
        <FormMessage state={confirmState} />
        <p className="text-sm font-medium text-slate-900">{s.backupCodes}</p>
        <p className="text-sm text-slate-600">{s.backupCodesHint}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 font-mono text-sm sm:grid-cols-5">
          {confirmState.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (enabled) {
    return (
      <form action={disableAction} className="space-y-3">
        <p className="text-sm text-emerald-800">✓ {s.enabled}</p>
        <Field label={t.auth.password} htmlFor="dis-pw">
          <Input id="dis-pw" name="password" type="password" required autoComplete="current-password" />
        </Field>
        <FormMessage state={disableState} />
        <SubmitButton variant="danger" size="sm">
          {s.disable}
        </SubmitButton>
      </form>
    );
  }

  if (!setup) {
    return (
      <button className={buttonClass("primary")} disabled={pending} onClick={() => start(async () => setSetup(await startTwoFactor()))}>
        {s.enable}
      </button>
    );
  }

  return (
    <form action={confirmAction} className="space-y-4">
      <p className="text-sm text-slate-700">{s.scan}</p>
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qr} alt="QR" width={180} height={180} className="rounded-xl ring-1 ring-slate-200" />
        <div className="space-y-2 text-sm">
          <p className="text-slate-600">{s.manualKey}</p>
          <code className="block break-all rounded-lg bg-slate-50 p-2 font-mono text-xs">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
        </div>
      </div>
      <Field label={s.confirmCode} htmlFor="totp-code">
        <Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required className="max-w-40 text-center tracking-[0.3em]" />
      </Field>
      <FormMessage state={confirmState} />
      <SubmitButton>{t.auth.verifyButton}</SubmitButton>
    </form>
  );
}

export function PasswordForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(changePassword, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.settings.security.currentPassword} htmlFor="pw-cur">
          <Input id="pw-cur" name="current" type="password" required autoComplete="current-password" />
        </Field>
        <Field label={t.settings.security.newPassword} htmlFor="pw-new">
          <Input id="pw-new" name="next" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary">{t.settings.security.changePassword}</SubmitButton>
    </form>
  );
}

export function LogoutOthers({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(logoutOtherDevices, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant="secondary" size="sm">
        {t.settings.security.logoutOthers}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

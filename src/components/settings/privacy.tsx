"use client";

import { useActionState, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Field, Input, buttonClass } from "@/components/ui";
import { FormMessage } from "@/components/ui/form";
import { ConfirmSubmit } from "@/components/ui/confirm";
import { dict, type Locale } from "@/lib/i18n";
import { eraseByPhoneAction, requestCompanyDeletion } from "@/app/(app)/_actions/privacy";

export function PhoneRequestForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const p = t.settings.privacy;
  const [phone, setPhone] = useState("");
  const [state, action] = useActionState(eraseByPhoneAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label={p.phone} htmlFor="priv-phone">
        <Input id="priv-phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="912 34 567" required />
      </Field>
      <div className="flex flex-wrap gap-2">
        <a
          href={phone ? `/api/privacy/export?phone=${encodeURIComponent(phone)}` : undefined}
          aria-disabled={!phone}
          className={buttonClass("secondary", "md", !phone ? "pointer-events-none opacity-50" : "")}
        >
          <Download className="h-4 w-4" aria-hidden /> {p.export}
        </a>
        <ConfirmSubmit message={p.eraseConfirm}>
          <Trash2 className="h-4 w-4" aria-hidden /> {p.erase}
        </ConfirmSubmit>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function DeleteCompanyForm({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const p = t.settings.privacy;
  const [state, action] = useActionState(requestCompanyDeletion, null);
  return (
    <form action={action} className="space-y-3">
      <Field label={p.deleteCompanyConfirm} htmlFor="del-confirm">
        <Input id="del-confirm" name="confirm" autoComplete="off" />
      </Field>
      <ConfirmSubmit message={p.deleteCompanyHint}>{p.deleteCompany}</ConfirmSubmit>
      <FormMessage state={state} />
    </form>
  );
}

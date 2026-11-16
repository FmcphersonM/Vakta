"use client";

import { useActionState, useState } from "react";
import { Copy, Phone } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { getNumberAction } from "@/app/(app)/_actions/phone";
import { dict, type Locale } from "@/lib/i18n";
import { fmt } from "@/lib/format";
import { forwardingCodes } from "@/lib/telephony/forwarding-codes";

export function GetNumberButton({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const [state, action] = useActionState(getNumberAction, null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton size="lg" pendingText={t.common.loading}>
        <Phone className="h-4 w-4" aria-hidden /> {t.settings.phone.getNumber}
      </SubmitButton>
      <FormMessage state={state?.ok ? null : state} />
    </form>
  );
}

function CodeRow({ label, code, t }: { label: string; code: string; t: ReturnType<typeof dict> }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="text-sm text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <code className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-sm text-slate-900">{code}</code>
        <button
          type="button"
          className={buttonClass("ghost", "sm", "!px-2")}
          aria-label={t.common.copy}
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="h-4 w-4" aria-hidden />
          <span className="sr-only">{copied ? t.common.copied : t.common.copy}</span>
        </button>
      </span>
    </li>
  );
}

export function NumberCard({ e164, locale, simulated }: { e164: string; locale: Locale; simulated: boolean }) {
  const t = dict(locale);
  const p = t.settings.phone;
  const codes = forwardingCodes(e164);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-slate-500">{p.yourNumber}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{fmt.phone(e164)}</p>
        {simulated ? <p className="mt-1 text-sm text-amber-800">{p.simulated}</p> : <p className="mt-1 text-sm text-slate-500">{p.testCall}</p>}
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">{p.modeTitle}</h2>
        <p className="mt-2 text-sm font-medium text-slate-800">1. {p.modeForward}</p>
        <p className="mt-1 text-sm text-slate-600">{p.codesIntro}</p>
        <ul className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 px-3">
          <CodeRow label={p.codeAll} code={codes.allConditional} t={t} />
          <CodeRow label={p.codeNoAnswer} code={codes.noAnswer} t={t} />
          <CodeRow label={p.codeBusy} code={codes.busy} t={t} />
          <CodeRow label={p.codeUnreachable} code={codes.unreachable} t={t} />
          <CodeRow label={p.codeCancel} code={codes.cancelAll} t={t} />
        </ul>
        <p className="mt-4 text-sm font-medium text-slate-800">2. {p.modeDirect}</p>
      </div>
    </div>
  );
}

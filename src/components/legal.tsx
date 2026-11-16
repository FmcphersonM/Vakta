import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

export function LegalPage({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Logo />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {note && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{note}</p>}
      <div className="mt-6 space-y-4 text-[0.95rem] leading-relaxed text-slate-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </main>
  );
}

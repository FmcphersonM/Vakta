import type { ReactNode } from "react";

export function Banner({ tone, icon, children, cta }: { tone: "amber" | "red" | "brand" | "slate"; icon: ReactNode; children: ReactNode; cta?: ReactNode }) {
  const tones = {
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    red: "bg-red-50 text-red-900 ring-red-200",
    brand: "bg-brand-50 text-brand-900 ring-brand-200",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  return (
    <div className={`mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl px-3 py-1.5 text-[13px] leading-snug ring-1 ${tones[tone]}`}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {cta}
    </div>
  );
}

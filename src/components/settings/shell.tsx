import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsPage({ title, back, intro, children }: { title: string; back: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {back}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {intro && <p className="mt-1 text-sm text-slate-500">{intro}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

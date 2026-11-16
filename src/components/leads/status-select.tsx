"use client";

import { useRef } from "react";
import { dict, type Locale } from "@/lib/i18n";
import { setLeadStatus } from "@/app/(app)/_actions/leads";
import type { LeadStatus } from "@/lib/db/schema";
import clsx from "clsx";

const tone: Record<LeadStatus, string> = {
  new: "bg-sky-50 text-sky-800 ring-sky-200",
  booked: "bg-brand-50 text-brand-800 ring-brand-200",
  quoted: "bg-violet-50 text-violet-800 ring-violet-200",
  won: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  lost: "bg-slate-100 text-slate-700 ring-slate-200",
};

/** Change a lead's status with one tap; submits as soon as a value is picked. */
export function StatusSelect({ id, status, locale, size = "sm" }: { id: string; status: LeadStatus; locale: Locale; size?: "sm" | "md" }) {
  const t = dict(locale);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={setLeadStatus}>
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`status-${id}`}>
        {t.leads.status}
      </label>
      <select
        id={`status-${id}`}
        name="status"
        defaultValue={status}
        onChange={() => ref.current?.requestSubmit()}
        className={clsx(
          "cursor-pointer appearance-none rounded-full border-0 font-medium ring-1 ring-inset focus:ring-2 focus:ring-brand-600",
          size === "sm" ? "py-1 pl-2.5 pr-6 text-xs" : "py-1.5 pl-3 pr-8 text-sm",
          tone[status],
        )}
        style={{ backgroundImage: "none" }}
      >
        {(["new", "booked", "quoted", "won", "lost"] as const).map((s) => (
          <option key={s} value={s}>
            {t.leadStatus[s]}
          </option>
        ))}
      </select>
    </form>
  );
}

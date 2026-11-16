import Link from "next/link";
import clsx from "clsx";
import { Flame, PhoneIncoming, FlaskConical } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { CALL_FILTERS, listCalls, type CallFilter } from "@/lib/queries/calls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { OutcomeBadge } from "@/components/badges";
import { fmt } from "@/lib/format";

export const metadata = { title: "Samtaler" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { t, company, locale } = await requireCompany();
  const sp = await searchParams;
  const filter: CallFilter = (CALL_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as CallFilter) : "all";
  const rows = await listCalls(company.id, filter);

  return (
    <div>
      <PageHeader title={t.calls.title} />
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <nav className="flex w-max gap-1.5">
          {CALL_FILTERS.map((f) => (
            <Link
              key={f}
              href={f === "all" ? "/calls" : `/calls?filter=${f}`}
              aria-current={filter === f ? "page" : undefined}
              className={clsx(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                filter === f ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {t.calls.filters[f]}
            </Link>
          ))}
        </nav>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<PhoneIncoming className="h-8 w-8" />}>{t.calls.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/calls/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <span
                    className={clsx(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      c.isEmergency ? "bg-red-100 text-red-700" : c.isTest ? "bg-slate-100 text-slate-500" : "bg-brand-50 text-brand-700",
                    )}
                  >
                    {c.isEmergency ? <Flame className="h-4 w-4" /> : c.isTest ? <FlaskConical className="h-4 w-4" /> : <PhoneIncoming className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
                      <span>{c.leadName ?? (c.fromNumber ? fmt.phone(c.fromNumber) : t.common.hiddenNumber)}</span>
                      <OutcomeBadge outcome={c.outcome} t={t} />
                      {c.isTest && <Badge>{t.calls.test}</Badge>}
                      {!c.reviewedAt && c.flagged && <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="!" />}
                    </p>
                    {c.summary && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{c.summary}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {fmt.dateTime(c.startedAt, locale, company.timezone)} · {fmt.duration(c.durationSeconds)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

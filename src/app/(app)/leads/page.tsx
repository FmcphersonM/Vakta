import Link from "next/link";
import clsx from "clsx";
import { Inbox, Plus, Search, MapPin } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { LEAD_STATUSES, listLeads } from "@/lib/queries/leads";
import { Card, EmptyState, Input, LinkButton, PageHeader } from "@/components/ui";
import { UrgencyBadge } from "@/components/badges";
import { StatusSelect } from "@/components/leads/status-select";
import { CallLink } from "@/components/call-link";
import { fmt } from "@/lib/format";

export const metadata = { title: "Henvendelser" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { t, company, locale } = await requireCompany();
  const sp = await searchParams;
  const { rows, counts } = await listLeads(company.id, sp);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs = [{ key: "", label: t.common.all, n: total }, ...LEAD_STATUSES.map((s) => ({ key: s, label: t.leadStatus[s], n: counts[s] ?? 0 }))];
  const active = sp.status ?? "";

  return (
    <div>
      <PageHeader
        title={t.leads.title}
        actions={
          <LinkButton href="/leads/new" size="md">
            <Plus className="h-4 w-4" aria-hidden /> {t.leads.newLead}
          </LinkButton>
        }
      />
      <form className="relative mb-3" role="search">
        {active && <input type="hidden" name="status" value={active} />}
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={t.leads.searchPlaceholder} className="pl-9" aria-label={t.common.search} type="search" />
      </form>
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <nav className="flex w-max gap-1.5" aria-label={t.leads.status}>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={{ pathname: "/leads", query: { ...(tab.key ? { status: tab.key } : {}), ...(sp.q ? { q: sp.q } : {}) } }}
              aria-current={active === tab.key ? "page" : undefined}
              className={clsx(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                active === tab.key ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {tab.label} <span className={clsx("ml-1 tabular-nums", active === tab.key ? "text-brand-100" : "text-slate-400")}>{tab.n}</span>
            </Link>
          ))}
        </nav>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Inbox className="h-8 w-8" />}>{sp.q || sp.status ? t.leads.emptyFiltered : t.leads.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {l.name ?? fmt.phone(l.phone) ?? t.common.unknownCaller}
                    <UrgencyBadge urgency={l.urgency} t={t} />
                  </p>
                  <p className="truncate text-sm text-slate-600">{l.jobTypeText ?? l.description ?? ""}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                    {l.address && <MapPin className="h-3 w-3 shrink-0" aria-hidden />}
                    <span className="truncate">{[l.address, fmt.relative(l.createdAt, locale)].filter(Boolean).join(" · ")}</span>
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden sm:block">
                    <StatusSelect id={l.id} status={l.status} locale={locale} />
                  </span>
                  <CallLink phone={l.phone} label={t.common.call} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

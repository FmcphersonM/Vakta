import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, MapPin, MessageSquare, PhoneIncoming, Trash2, CalendarCheck } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { getLead } from "@/lib/queries/leads";
import { Badge, Card, CardHeader, EmptyState, LinkButton, buttonClass } from "@/components/ui";
import { OutcomeBadge, UrgencyBadge } from "@/components/badges";
import { StatusSelect } from "@/components/leads/status-select";
import { LeadForm } from "@/components/leads/lead-form";
import { CallLink } from "@/components/call-link";
import { ConfirmSubmit } from "@/components/ui/confirm";
import { fmt, mapsUrl } from "@/lib/format";
import { eraseLeadData } from "../../_actions/leads";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, company, locale } = await requireCompany();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getLead(company.id, id);
  if (!data) notFound();
  const { lead } = data;
  const tz = company.timezone;

  return (
    <div className="space-y-4">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.leads.title}
      </Link>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{lead.name ?? fmt.phone(lead.phone) ?? t.common.unknownCaller}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {lead.jobTypeText ?? ""} · {t.leads.created} {fmt.dateTime(lead.createdAt, locale, tz)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusSelect id={lead.id} status={lead.status} locale={locale} size="md" />
              <UrgencyBadge urgency={lead.urgency} t={t} />
              {lead.inServiceArea === false && <Badge tone="amber">{t.leads.outsideArea}</Badge>}
              {lead.valueNok ? <Badge tone="green">{fmt.nok(lead.valueNok, locale)}</Badge> : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <CallLink phone={lead.phone} label={t.common.call} className="w-full sm:w-auto" />
          {lead.phone && (
            <a href={`sms:${lead.phone}`} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              <MessageSquare className="h-4 w-4" aria-hidden /> {t.common.sms}
            </a>
          )}
          {lead.address && (
            <a href={mapsUrl(lead.address)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              <MapPin className="h-4 w-4" aria-hidden /> {t.common.map}
            </a>
          )}
        </div>
        {(lead.description || lead.address || lead.preferredTimes) && (
          <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
            {lead.description && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t.leads.description}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-slate-900">{lead.description}</dd>
              </div>
            )}
            {lead.address && (
              <div>
                <dt className="text-slate-500">{t.leads.address}</dt>
                <dd className="mt-0.5 text-slate-900">{lead.address}</dd>
              </div>
            )}
            {lead.preferredTimes && (
              <div>
                <dt className="text-slate-500">{t.leads.preferredTimes}</dt>
                <dd className="mt-0.5 text-slate-900">{lead.preferredTimes}</dd>
              </div>
            )}
            {lead.phone && (
              <div>
                <dt className="text-slate-500">{t.leads.phone}</dt>
                <dd className="mt-0.5 text-slate-900">{fmt.phone(lead.phone)}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t.leads.befaringer}
            action={
              <LinkButton href={`/calendar?lead=${lead.id}`} variant="secondary" size="sm">
                <CalendarPlus className="h-4 w-4" aria-hidden /> {t.leads.bookBefaring}
              </LinkButton>
            }
          />
          {data.appts.length === 0 ? (
            <EmptyState icon={<CalendarCheck className="h-7 w-7" />}>{t.leads.noBefaring}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.appts.map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm sm:px-5">
                  <p className="font-medium text-slate-900 first-letter:uppercase">
                    {fmt.dayLong(a.startsAt, locale, tz)} {fmt.time(a.startsAt, locale, tz)}–{fmt.time(a.endsAt, locale, tz)}
                  </p>
                  <p className="text-slate-600">
                    {a.title}
                    {a.assignedName ? ` · ${a.assignedName}` : ""}
                    {a.status !== "scheduled" ? ` · ${a.status}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t.leads.calls} />
          {data.calls.length === 0 ? (
            <EmptyState icon={<PhoneIncoming className="h-7 w-7" />}>{t.calls.empty}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.calls.map((c) => (
                <li key={c.id}>
                  <Link href={`/calls/${c.id}`} className="block px-4 py-3 text-sm hover:bg-slate-50 sm:px-5">
                    <p className="flex items-center gap-2 font-medium text-slate-900">
                      {fmt.dateTime(c.startedAt, locale, tz)} <OutcomeBadge outcome={c.outcome} t={t} />
                    </p>
                    {c.summary && <p className="mt-0.5 line-clamp-2 text-slate-600">{c.summary}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t.common.edit} />
        <div className="p-4 sm:p-5">
          <LeadForm locale={locale} lead={lead} jobTypeNames={data.jobTypes.map((j) => j.name)} />
        </div>
      </Card>

      <form action={eraseLeadData} className="flex justify-end">
        <input type="hidden" name="id" value={lead.id} />
        <ConfirmSubmit message={t.leads.deleteConfirm} size="sm">
          <Trash2 className="h-4 w-4" aria-hidden /> {t.leads.deleteLead}
        </ConfirmSubmit>
      </form>
    </div>
  );
}

import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarCheck, ChevronRight, Inbox, MapPin, PhoneMissed, Sparkles, Flame, ShieldCheck, FlaskConical } from "lucide-react";
import { Banner } from "@/components/shell/banner";
import { features } from "@/lib/env";
import { requireCompany } from "@/lib/auth/current";
import { todayData } from "@/lib/queries/dashboard";
import { Card, CardHeader, EmptyState, LinkButton, StatTile } from "@/components/ui";
import { UrgencyBadge, OutcomeBadge } from "@/components/badges";
import { CallLink } from "@/components/call-link";
import { fmt, mapsUrl } from "@/lib/format";
import { markCallReviewed } from "../_actions/calls";

export const metadata = { title: "I dag" };

export default async function TodayPage() {
  const { t, company, user, locale } = await requireCompany();
  const data = await todayData(company.id, company.timezone);
  const now = DateTime.now().setZone(company.timezone);
  const first = user.name.split(" ")[0];
  const greeting = now.hour < 10 ? t.today.greetingMorning(first) : now.hour >= 18 ? t.today.greetingEvening(first) : t.today.greetingDay(first);

  return (
    <div className="space-y-5">
      {(!user.totpEnabledAt || !features.twilio()) && (
        <div>
          {!user.totpEnabledAt && (
            <Banner tone="slate" icon={<ShieldCheck className="h-4 w-4" />} cta={<Link href="/settings/security" className="font-semibold underline">{t.banners.enable2faCta}</Link>}>
              {t.banners.enable2fa}
            </Banner>
          )}
          {!features.twilio() && (
            <Banner tone="slate" icon={<FlaskConical className="h-4 w-4" />}>
              {t.banners.simulatedTelephony}
            </Banner>
          )}
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting}</h1>
        <p className="mt-0.5 text-sm text-slate-500 first-letter:uppercase">{fmt.dayLong(new Date(), locale, company.timezone)}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile label={t.today.befaringerToday} value={data.today.length} href="/calendar" tone="brand" icon={<CalendarCheck className="h-4 w-4" />} />
        <StatTile label={t.today.newLeads} value={data.newLeadCount} href="/leads?status=new" icon={<Inbox className="h-4 w-4" />} />
        <StatTile label={t.today.needsAttention} value={data.flagged.length} href="#oppfolging" tone={data.flagged.length ? "amber" : "neutral"} icon={<PhoneMissed className="h-4 w-4" />} />
      </div>

      {!data.hasCalls && (
        <Card className="flex flex-col gap-3 bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white sm:flex-row sm:items-center">
          <Sparkles className="h-8 w-8 shrink-0 text-brand-200" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">{t.today.tryAgentTitle}</p>
            <p className="text-sm text-brand-100">{t.today.tryAgentBody}</p>
          </div>
          <LinkButton href="/test-agent" variant="secondary">{t.today.tryAgentCta}</LinkButton>
        </Card>
      )}

      {data.flagged.length > 0 && (
        <Card id="oppfolging" className="ring-amber-300">
          <CardHeader title={t.today.flaggedTitle} />
          <ul className="divide-y divide-slate-100">
            {data.flagged.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${c.isEmergency ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                  {c.isEmergency ? <Flame className="h-4 w-4" /> : <PhoneMissed className="h-4 w-4" />}
                </span>
                <Link href={`/calls/${c.id}`} className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {c.leadName ?? (c.fromNumber ? fmt.phone(c.fromNumber) : t.common.hiddenNumber)}
                    <OutcomeBadge outcome={c.outcome} t={t} />
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{c.flagReason ?? c.summary ?? ""}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{fmt.relative(c.startedAt, locale)}</p>
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <CallLink phone={c.fromNumber} label={t.common.callBack} />
                  <form action={markCallReviewed}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-xs font-medium text-slate-500 hover:text-slate-800">{t.common.markHandled}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t.today.todayTitle} action={<Link href="/calendar" className="text-sm font-medium text-brand-700">{t.nav.calendar}</Link>} />
          {data.today.length === 0 ? (
            <EmptyState icon={<CalendarCheck className="h-8 w-8" />}>{t.today.todayEmpty}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.today.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <div className="w-12 shrink-0 pt-0.5 text-right">
                    <p className="font-semibold tabular-nums text-slate-900">{fmt.time(a.startsAt, locale, company.timezone)}</p>
                    <p className="text-xs tabular-nums text-slate-400">{fmt.time(a.endsAt, locale, company.timezone)}</p>
                  </div>
                  <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: a.color ?? "#2f9195" }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link href={a.leadId ? `/leads/${a.leadId}` : "/calendar"} className="font-medium text-slate-900 hover:underline">
                      {a.customerName ?? a.title}
                    </Link>
                    <p className="truncate text-sm text-slate-600">{a.title}</p>
                    {a.address && (
                      <a href={mapsUrl(a.address)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm text-brand-700">
                        <MapPin className="h-3.5 w-3.5" aria-hidden /> <span className="truncate">{a.address}</span>
                      </a>
                    )}
                    {a.assignedName && <p className="text-xs text-slate-400">{a.assignedName}</p>}
                  </div>
                  <CallLink phone={a.customerPhone} label={t.common.call} compact />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t.today.leadsTitle} action={<Link href="/leads" className="text-sm font-medium text-brand-700">{t.common.seeAll}</Link>} />
          {data.newLeads.length === 0 ? (
            <EmptyState icon={<Inbox className="h-8 w-8" />}>{t.today.leadsEmpty}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.newLeads.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {l.name ?? fmt.phone(l.phone)} <UrgencyBadge urgency={l.urgency} t={t} />
                    </p>
                    <p className="truncate text-sm text-slate-600">{[l.jobTypeText, l.city ?? l.address].filter(Boolean).join(" · ")}</p>
                    <p className="text-xs text-slate-400">{fmt.relative(l.createdAt, locale)}</p>
                  </Link>
                  <CallLink phone={l.phone} label={t.common.call} compact />
                  <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={t.today.upcomingTitle} />
        {data.upcoming.length === 0 ? (
          <EmptyState>{t.today.upcomingEmpty}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.upcoming.map((a) => (
              <li key={a.id}>
                <Link href={a.leadId ? `/leads/${a.leadId}` : "/calendar"} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                  <span className="w-28 shrink-0 text-sm text-slate-500 first-letter:uppercase">{fmt.dayShort(a.startsAt, locale, company.timezone)}</span>
                  <span className="w-12 shrink-0 text-sm font-medium tabular-nums">{fmt.time(a.startsAt, locale, company.timezone)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{a.customerName ?? a.title} · {a.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, CheckCircle2, Inbox, Sparkles } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { getCall } from "@/lib/queries/calls";
import { Badge, Card, CardHeader, LinkButton, buttonClass } from "@/components/ui";
import { OutcomeBadge, UrgencyBadge } from "@/components/badges";
import { CallLink } from "@/components/call-link";
import { fmt } from "@/lib/format";
import { markCallReviewed } from "../../_actions/calls";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, company, locale } = await requireCompany();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await getCall(company.id, id);
  if (!row) notFound();
  const { call, lead } = row;
  const tz = company.timezone;
  const who = lead?.name ?? (call.fromNumber ? fmt.phone(call.fromNumber) : t.common.hiddenNumber);

  return (
    <div className="space-y-4">
      <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.calls.title}
      </Link>

      {/* 1. Summary first */}
      <Card className={clsx("p-4 sm:p-6", call.isEmergency && "ring-2 ring-red-300")}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">{who}</h1>
          <OutcomeBadge outcome={call.outcome} t={t} />
          {call.summaryJson?.urgency && <UrgencyBadge urgency={call.summaryJson.urgency} t={t} />}
          {call.isTest && <Badge>{t.calls.test}</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {fmt.dateTime(call.startedAt, locale, tz)} · {fmt.duration(call.durationSeconds)}
          {call.fromNumber && lead?.name ? ` · ${fmt.phone(call.fromNumber)}` : ""}
        </p>
        <div className="mt-4 rounded-xl bg-brand-50/60 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-800">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t.calls.summary}
          </p>
          <p className="text-[0.95rem] leading-relaxed text-slate-900">{call.summary ?? t.calls.noSummary}</p>
          {call.summaryJson?.follow_up && <p className="mt-2 text-sm font-medium text-amber-900">→ {call.summaryJson.follow_up}</p>}
          {call.flagReason && !call.summaryJson?.follow_up && <p className="mt-2 text-sm font-medium text-amber-900">→ {call.flagReason}</p>}
          {call.transferredTo && <p className="mt-2 text-sm text-slate-700">{t.calls.transferredTo(fmt.phone(call.transferredTo))}</p>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <CallLink phone={call.fromNumber} label={t.common.callBack} />
          {lead && (
            <LinkButton href={`/leads/${lead.id}`} variant="secondary">
              <Inbox className="h-4 w-4" aria-hidden /> {t.calls.openLead}
            </LinkButton>
          )}
          {call.reviewedAt ? (
            <span className={buttonClass("ghost", "md", "pointer-events-none text-emerald-700")}>
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.calls.reviewed}
            </span>
          ) : (
            <form action={markCallReviewed}>
              <input type="hidden" name="id" value={call.id} />
              <button className={buttonClass("secondary")}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.calls.markReviewed}
              </button>
            </form>
          )}
        </div>
      </Card>

      {/* 2. Recording */}
      <Card>
        <CardHeader title={t.calls.recording} />
        <div className="p-4 sm:p-5">
          {call.recordingDeletedAt ? (
            <p className="text-sm text-slate-500">{t.calls.recordingDeleted}</p>
          ) : call.recordingSid ? (
            <audio controls preload="none" className="w-full" src={`/api/recordings/${call.id}`}>
              <track kind="captions" />
            </audio>
          ) : (
            <p className="text-sm text-slate-500">{t.calls.noRecording}</p>
          )}
        </div>
      </Card>

      {/* 3. Transcript */}
      <Card>
        <CardHeader title={t.calls.transcript} />
        <ol className="space-y-3 p-4 sm:p-5">
          {call.transcript.map((e, i) =>
            e.role === "system" ? (
              <li key={i} className="text-center text-xs text-slate-400">
                {e.text}
              </li>
            ) : (
              <li key={i} className={clsx("flex", e.role === "caller" ? "justify-end" : "justify-start")}>
                <div
                  className={clsx(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[0.95rem] leading-snug",
                    e.role === "caller" ? "rounded-br-md bg-brand-700 text-white" : "rounded-bl-md bg-slate-100 text-slate-900",
                  )}
                >
                  <p className={clsx("mb-0.5 text-[11px] font-medium", e.role === "caller" ? "text-brand-100" : "text-slate-500")}>
                    {e.role === "caller" ? t.calls.callerLabel : t.calls.agent} · {fmt.time(e.at, locale, tz)}
                  </p>
                  {e.text}
                </div>
              </li>
            ),
          )}
        </ol>
      </Card>
    </div>
  );
}

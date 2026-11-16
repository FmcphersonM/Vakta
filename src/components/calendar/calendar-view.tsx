"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import nbLocale from "@fullcalendar/core/locales/nb";
import type { EventClickArg, EventDropArg, DateSelectArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { DateTime } from "luxon";
import { MapPin, Phone, Plus, X, Inbox, CheckCircle2, UserX, Ban } from "lucide-react";
import Link from "next/link";
import { dict, type Locale } from "@/lib/i18n";
import { Button, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import {
  createAppointmentAction,
  moveAppointmentAction,
  setAppointmentStatusAction,
} from "@/app/(app)/_actions/appointments";
import type { BusinessHours } from "@/lib/db/schema";

type Member = { userId: string; name: string; color: string; doesBefaring: boolean };
type Prefill = { leadId: string; name: string | null; phone: string | null; address: string | null; title: string } | null;
type Props = {
  locale: Locale;
  tz: string;
  members: Member[];
  businessHours: BusinessHours;
  befaringMinutes: number;
  prefill: Prefill;
  currentUserId: string;
};

type Pending = { id: string; start: Date; end: Date; title: string; hasPhone: boolean; revert: () => void } | null;

function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Lukk">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}>
        {children}
      </div>
    </dialog>
  );
}

export function CalendarView({ locale, tz, members, businessHours, befaringMinutes, prefill, currentUserId }: Props) {
  const t = dict(locale);
  const router = useRouter();
  const calRef = useRef<FullCalendar>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [who, setWho] = useState<string>("all");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notify, setNotify] = useState(true);
  const [selected, setSelected] = useState<EventClickArg["event"] | null>(null);
  const [createAt, setCreateAt] = useState<Date | null>(prefill ? DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0 }).toJSDate() : null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    calRef.current?.getApi().changeView(isMobile ? "timeGridDay" : "timeGridWeek");
  }, [isMobile]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const fcBusinessHours = useMemo(
    () =>
      Object.entries(businessHours).flatMap(([day, ranges]) =>
        ranges.map((r) => ({ daysOfWeek: [Number(day) % 7], startTime: r.start, endTime: r.end })),
      ),
    [businessHours],
  );
  const [minTime, maxTime] = useMemo(() => {
    const all = Object.values(businessHours).flat();
    if (!all.length) return ["07:00", "18:00"];
    const min = all.map((r) => r.start).sort()[0];
    const max = all.map((r) => r.end).sort().at(-1)!;
    const h = (s: string, d: number) => `${String(Math.min(24, Math.max(0, Number(s.slice(0, 2)) + d))).padStart(2, "0")}:00`;
    return [h(min, -1), h(max, 2)];
  }, [businessHours]);

  const fetchEvents = useCallback(
    async (info: { startStr: string; endStr: string }, ok: (e: EventInput[]) => void, fail: (e: Error) => void) => {
      try {
        const res = await fetch(`/api/calendar/events?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { events: EventInput[]; busy: EventInput[] };
        const filter = (e: EventInput) => who === "all" || (e.extendedProps as { assignedUserId?: string })?.assignedUserId === who;
        ok([...data.events.filter(filter), ...data.busy.filter(filter)]);
      } catch (e) {
        fail(e as Error);
      }
    },
    [who],
  );

  const onMove = (arg: EventDropArg | EventResizeDoneArg) => {
    const ev = arg.event;
    setNotify(Boolean(ev.extendedProps.customerPhone));
    setPending({ id: ev.id, start: ev.start!, end: ev.end!, title: ev.title, hasPhone: Boolean(ev.extendedProps.customerPhone), revert: arg.revert });
  };

  const confirmMove = async () => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    const res = await moveAppointmentAction({ id: p.id, start: p.start.toISOString(), end: p.end.toISOString(), notify: notify && p.hasPhone });
    if (!res.ok) {
      p.revert();
      setToast({ text: res.error ?? t.common.error, error: true });
    } else {
      setToast({ text: t.calendar.moved });
      router.refresh();
    }
  };

  const changeStatus = async (status: "completed" | "no_show" | "cancelled") => {
    if (!selected) return;
    if (status === "cancelled" && !window.confirm(t.calendar.cancelConfirm)) return;
    await setAppointmentStatusAction({ id: selected.id, status });
    setSelected(null);
    calRef.current?.getApi().refetchEvents();
    router.refresh();
  };

  const fmtRange = (s: Date, e: Date) => {
    const a = DateTime.fromJSDate(s).setZone(tz).setLocale(locale === "en" ? "en-GB" : "nb");
    const b = DateTime.fromJSDate(e).setZone(tz);
    return `${a.toFormat(locale === "en" ? "cccc d MMMM, HH:mm" : "cccc d. MMMM, HH:mm")}–${b.toFormat("HH:mm")}`;
  };

  const sp = selected?.extendedProps as
    | { address?: string; customerName?: string; customerPhone?: string; notes?: string; leadId?: string; assignedName?: string; status?: string; rawTitle?: string }
    | undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="who">
          {t.calendar.assignedTo}
        </label>
        <Select id="who" value={who} onChange={(e) => setWho(e.target.value)} className="!w-auto !py-2 text-sm">
          <option value="all">{t.calendar.everyone}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
        <div className="hidden flex-wrap gap-3 text-xs text-slate-600 sm:flex">
          {members.map((m) => (
            <span key={m.userId} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} /> {m.name.split(" ")[0]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> {t.calendar.busy}
          </span>
        </div>
        <Button className="ml-auto" onClick={() => setCreateAt(DateTime.now().plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0 }).toJSDate())}>
          <Plus className="h-4 w-4" aria-hidden /> {t.calendar.newBefaring}
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/70 sm:p-3">
        <FullCalendar
          key={who}
          ref={calRef}
          plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView="timeGridWeek"
          locales={[nbLocale]}
          locale={locale === "en" ? "en-gb" : "nb"}
          timeZone={tz}
          firstDay={1}
          headerToolbar={isMobile ? { left: "prev,next", center: "title", right: "today" } : { left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek" }}
          footerToolbar={isMobile ? { center: "timeGridDay,timeGridWeek" } : undefined}
          buttonText={{ today: t.calendar.today, day: t.calendar.day, week: t.calendar.week }}
          allDaySlot={false}
          nowIndicator
          editable
          eventDurationEditable
          selectable
          selectMirror
          longPressDelay={350}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          slotMinTime={minTime}
          slotMaxTime={maxTime}
          businessHours={fcBusinessHours}
          height="auto"
          expandRows
          slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          events={fetchEvents}
          eventDrop={onMove}
          eventResize={onMove}
          eventClick={(arg) => {
            if (arg.event.extendedProps.kind === "appointment") setSelected(arg.event);
          }}
          select={(arg: DateSelectArg) => {
            setCreateAt(arg.start);
            arg.view.calendar.unselect();
          }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500 md:hidden">{t.calendar.dragHint}</p>

      {/* Confirm move */}
      <Dialog open={!!pending} onClose={() => { pending?.revert(); setPending(null); }} title={t.calendar.rescheduleConfirm}>
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{pending.title}</span>
              <br />
              <span className="first-letter:uppercase">{fmtRange(pending.start, pending.end)}</span>
            </p>
            {pending.hasPhone && (
              <label className="flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-brand-700" />
                {t.calendar.notifyCustomer}
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { pending.revert(); setPending(null); }}>
                {t.common.cancel}
              </Button>
              <Button onClick={confirmMove}>{t.common.save}</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Details */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} title={sp?.customerName ?? selected?.title ?? ""}>
        {selected && sp && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-slate-900 first-letter:uppercase">{fmtRange(selected.start!, selected.end!)}</p>
              <p className="text-slate-600">
                {sp.rawTitle}
                {sp.assignedName ? ` · ${sp.assignedName}` : ""}
              </p>
            </div>
            {sp.notes && <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{sp.notes}</p>}
            <div className="grid grid-cols-2 gap-2">
              {sp.customerPhone && (
                <a href={`tel:${sp.customerPhone}`} className={buttonClass("primary")}>
                  <Phone className="h-4 w-4" aria-hidden /> {t.common.call}
                </a>
              )}
              {sp.address && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sp.address)}`} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
                  <MapPin className="h-4 w-4" aria-hidden /> {t.common.map}
                </a>
              )}
              {sp.leadId && (
                <Link href={`/leads/${sp.leadId}`} className={buttonClass("secondary", "md", "col-span-2")}>
                  <Inbox className="h-4 w-4" aria-hidden /> {t.calls.openLead}
                </Link>
              )}
            </div>
            {sp.address && <p className="text-slate-600">{sp.address}</p>}
            {sp.status === "scheduled" && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Button variant="success" size="sm" onClick={() => changeStatus("completed")}>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.calendar.markCompleted}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => changeStatus("no_show")}>
                  <UserX className="h-4 w-4" aria-hidden /> {t.calendar.markNoShow}
                </Button>
                <Button variant="danger" size="sm" onClick={() => changeStatus("cancelled")}>
                  <Ban className="h-4 w-4" aria-hidden /> {t.calendar.cancelBefaring}
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Create */}
      <Dialog open={!!createAt} onClose={() => setCreateAt(null)} title={t.calendar.newBefaring}>
        {createAt && (
          <CreateForm
            key={createAt.toISOString()}
            locale={locale}
            tz={tz}
            start={createAt}
            members={members}
            defaultMinutes={befaringMinutes}
            prefill={prefill}
            currentUserId={currentUserId}
            onDone={() => {
              setCreateAt(null);
              calRef.current?.getApi().refetchEvents();
              setToast({ text: t.calendar.created });
              router.refresh();
            }}
          />
        )}
      </Dialog>

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg lg:bottom-6 ${toast.error ? "bg-red-700" : "bg-slate-900"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function CreateForm({
  locale,
  tz,
  start,
  members,
  defaultMinutes,
  prefill,
  currentUserId,
  onDone,
}: {
  locale: Locale;
  tz: string;
  start: Date;
  members: Member[];
  defaultMinutes: number;
  prefill: Prefill;
  currentUserId: string;
  onDone: () => void;
}) {
  const t = dict(locale);
  const [state, action] = useActionState(createAppointmentAction, null);
  const dt = DateTime.fromJSDate(start).setZone(tz);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  const assignable = members.filter((m) => m.doesBefaring);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={prefill?.leadId ?? ""} />
      <Field label={t.calendar.customer} htmlFor="customerName">
        <Input id="customerName" name="customerName" defaultValue={prefill?.name ?? ""} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.calendar.phone} htmlFor="customerPhone">
          <Input id="customerPhone" name="customerPhone" type="tel" defaultValue={prefill?.phone ?? ""} />
        </Field>
        <Field label={t.calendar.assignedTo} htmlFor="assignedUserId">
          <Select id="assignedUserId" name="assignedUserId" defaultValue={assignable.find((m) => m.userId === currentUserId)?.userId ?? assignable[0]?.userId}>
            {assignable.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t.calendar.address} htmlFor="address">
        <Input id="address" name="address" defaultValue={prefill?.address ?? ""} />
      </Field>
      <Field label={t.leads.jobType} htmlFor="title">
        <Input id="title" name="title" defaultValue={prefill ? `Befaring: ${prefill.title}` : "Befaring"} required />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t.calendar.start} htmlFor="date" className="col-span-2">
          <div className="flex gap-2">
            <Input id="date" name="date" type="date" defaultValue={dt.toISODate()!} required />
            <Input name="time" type="time" step={900} defaultValue={dt.toFormat("HH:mm")} required aria-label="Tid" className="!w-28" />
          </div>
        </Field>
        <Field label={t.calendar.duration} htmlFor="minutes">
          <Select id="minutes" name="minutes" defaultValue={String(defaultMinutes)}>
            {[30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {t.common.minutes(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t.calendar.notes} htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>
      <label className="flex items-center gap-3 text-sm text-slate-700">
        <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-brand-700" />
        {t.calendar.notifyCustomer}
      </label>
      <FormMessage state={state?.ok ? null : state} />
      <div className="flex justify-end">
        <SubmitButton pendingText={t.common.saving}>{t.common.save}</SubmitButton>
      </div>
    </form>
  );
}

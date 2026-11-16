"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DateTime } from "luxon";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { appointments } from "@/lib/db/schema";
import { createAppointment, moveAppointment, setAppointmentStatus, SlotConflictError } from "@/lib/appointments";
import { sendSms } from "@/lib/sms";
import { sms } from "@/lib/sms/templates";
import { normalizePhone } from "@/lib/format";
import { geocodeAddress } from "@/lib/booking/geocode";
import type { ActionState } from "@/components/ui/form";

function revalidate() {
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/leads", "layout");
}

const moveSchema = z.object({
  id: z.string().uuid(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  notify: z.boolean(),
});

export async function moveAppointmentAction(input: z.infer<typeof moveSchema>): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireCompany();
  const p = moveSchema.parse(input);
  try {
    const appt = await moveAppointment({
      companyId: ctx.company.id,
      id: p.id,
      startsAt: new Date(p.start),
      endsAt: new Date(p.end),
      actor: { userId: ctx.user.id, kind: "user" },
    });
    if (p.notify && appt.customerPhone) {
      await sendSms({
        companyId: ctx.company.id,
        company: ctx.company,
        to: appt.customerPhone,
        purpose: "reschedule",
        appointmentId: appt.id,
        leadId: appt.leadId,
        body: sms.rescheduled({
          companyName: ctx.company.name,
          companyPhone: ctx.company.phone,
          locale: ctx.company.locale === "en" ? "en" : "nb",
          tz: ctx.company.timezone,
          name: appt.customerName,
          start: appt.startsAt,
        }),
      });
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    if (e instanceof SlotConflictError) return { ok: false, error: ctx.t.calendar.conflict };
    console.error(e);
    return { ok: false, error: ctx.t.common.error };
  }
}

const createSchema = z.object({
  leadId: z.string().uuid().optional().or(z.literal("")),
  customerName: z.string().trim().max(120),
  customerPhone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  minutes: z.coerce.number().int().min(15).max(480),
  assignedUserId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
  notify: z.string().optional(),
});

export async function createAppointmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: ctx.t.common.error };
  const p = parsed.data;
  const start = DateTime.fromISO(`${p.date}T${p.time}`, { zone: ctx.company.timezone });
  if (!start.isValid) return { error: ctx.t.common.error };
  const phone = normalizePhone(p.customerPhone);
  const geo = p.address ? await geocodeAddress(p.address).catch(() => null) : null;
  try {
    const appt = await createAppointment({
      companyId: ctx.company.id,
      actor: { userId: ctx.user.id, kind: "user" },
      leadId: p.leadId || null,
      assignedUserId: p.assignedUserId,
      title: p.title,
      startsAt: start.toJSDate(),
      endsAt: start.plus({ minutes: p.minutes }).toJSDate(),
      address: geo?.address ?? p.address ?? null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      customerName: p.customerName || null,
      customerPhone: phone,
      notes: p.notes || null,
    });
    if (p.notify === "on" && phone) {
      await sendSms({
        companyId: ctx.company.id,
        company: ctx.company,
        to: phone,
        purpose: "booking_confirmation",
        appointmentId: appt.id,
        leadId: appt.leadId,
        body: sms.bookingConfirmation({
          companyName: ctx.company.name,
          companyPhone: ctx.company.phone,
          locale: ctx.company.locale === "en" ? "en" : "nb",
          tz: ctx.company.timezone,
          name: appt.customerName,
          start: appt.startsAt,
          address: appt.address,
        }),
      });
    }
  } catch (e) {
    if (e instanceof SlotConflictError) return { error: ctx.t.calendar.conflict };
    throw e;
  }
  revalidate();
  return { ok: true, message: ctx.t.calendar.created };
}

export async function setAppointmentStatusAction(input: { id: string; status: "completed" | "no_show" | "cancelled" }) {
  const ctx = await requireCompany();
  const id = z.string().uuid().parse(input.id);
  const status = z.enum(["completed", "no_show", "cancelled"]).parse(input.status);
  const appt = await setAppointmentStatus(ctx.company.id, id, status, { userId: ctx.user.id, kind: "user" });
  if (appt && status === "cancelled" && appt.customerPhone && appt.startsAt > new Date()) {
    await sendSms({
      companyId: ctx.company.id,
      company: ctx.company,
      to: appt.customerPhone,
      purpose: "cancellation",
      appointmentId: appt.id,
      leadId: appt.leadId,
      body: sms.cancelled({
        companyName: ctx.company.name,
        companyPhone: ctx.company.phone,
        locale: ctx.company.locale === "en" ? "en" : "nb",
        tz: ctx.company.timezone,
        name: appt.customerName,
        start: appt.startsAt,
      }),
    });
  }
  revalidate();
  return { ok: true };
}


import { and, eq } from "drizzle-orm";
import { withTenant } from "./db/client";
import { appointments, leads, type Appointment, type AppointmentStatus } from "./db/schema";
import { audit } from "./audit";
import { EXCLUSION_VIOLATION, pgCode } from "./db/errors";
import { pushAppointment } from "./calendar/sync";

/** The person already has a befaring at that time (enforced by the database). */
export class SlotConflictError extends Error {
  constructor() {
    super("slot_conflict");
  }
}

type Actor = { userId: string | null; kind: "ai" | "user" };

export async function createAppointment(input: {
  companyId: string;
  actor: Actor;
  leadId?: string | null;
  callId?: string | null;
  assignedUserId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
}): Promise<Appointment> {
  let appt: Appointment;
  try {
    appt = await withTenant(input.companyId, async (tx) => {
      const [row] = await tx
        .insert(appointments)
        .values({
          companyId: input.companyId,
          leadId: input.leadId ?? null,
          callId: input.callId ?? null,
          assignedUserId: input.assignedUserId,
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          customerName: input.customerName ?? null,
          customerPhone: input.customerPhone ?? null,
          notes: input.notes ?? null,
          createdBy: input.actor.kind,
        })
        .returning();
      if (input.leadId) {
        await tx.update(leads).set({ status: "booked" }).where(and(eq(leads.id, input.leadId), eq(leads.status, "new")));
      }
      await audit(tx, {
        companyId: input.companyId,
        userId: input.actor.userId,
        actor: input.actor.kind,
        action: "appointment.created",
        entityType: "appointment",
        entityId: row.id,
        metadata: { startsAt: row.startsAt.toISOString(), assignedUserId: row.assignedUserId },
      });
      return row;
    });
  } catch (e) {
    if (pgCode(e) === EXCLUSION_VIOLATION) throw new SlotConflictError();
    throw e;
  }
  void pushAppointment(input.companyId, appt.id).catch((e) => console.error("[calendar] push failed", e));
  return appt;
}

export async function moveAppointment(input: {
  companyId: string;
  id: string;
  startsAt: Date;
  endsAt: Date;
  assignedUserId?: string;
  actor: Actor;
}): Promise<Appointment> {
  let appt: Appointment | undefined;
  try {
    appt = await withTenant(input.companyId, async (tx) => {
      const [row] = await tx
        .update(appointments)
        .set({
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reminderSentAt: null, // a moved befaring gets a fresh reminder
          ...(input.assignedUserId ? { assignedUserId: input.assignedUserId } : {}),
        })
        .where(eq(appointments.id, input.id))
        .returning();
      if (!row) return undefined;
      await audit(tx, {
        companyId: input.companyId,
        userId: input.actor.userId,
        actor: input.actor.kind,
        action: "appointment.moved",
        entityType: "appointment",
        entityId: row.id,
        metadata: { startsAt: row.startsAt.toISOString() },
      });
      return row;
    });
  } catch (e) {
    if (pgCode(e) === EXCLUSION_VIOLATION) throw new SlotConflictError();
    throw e;
  }
  if (!appt) throw new Error("not_found");
  void pushAppointment(input.companyId, appt.id).catch((e) => console.error("[calendar] push failed", e));
  return appt;
}

export async function setAppointmentStatus(companyId: string, id: string, status: AppointmentStatus, actor: Actor) {
  const appt = await withTenant(companyId, async (tx) => {
    const [row] = await tx.update(appointments).set({ status }).where(eq(appointments.id, id)).returning();
    if (row) {
      await audit(tx, {
        companyId,
        userId: actor.userId,
        actor: actor.kind,
        action: `appointment.${status}`,
        entityType: "appointment",
        entityId: id,
      });
    }
    return row;
  });
  if (appt) void pushAppointment(companyId, appt.id).catch((e) => console.error("[calendar] push failed", e));
  return appt;
}

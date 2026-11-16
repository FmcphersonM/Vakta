import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { withTenant } from "../db/client";
import { appointments, busyBlocks, memberships, users } from "../db/schema";

export async function teamMembers(companyId: string) {
  return withTenant(companyId, (tx) =>
    tx
      .select({ userId: users.id, name: users.name, role: memberships.role, color: memberships.color, doesBefaring: memberships.doesBefaring, phone: users.phone, email: users.email, totp: users.totpEnabledAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(memberships.createdAt),
  );
}

export async function calendarEvents(companyId: string, start: Date, end: Date) {
  return withTenant(companyId, async (tx) => {
    const appts = await tx
      .select({
        id: appointments.id,
        title: appointments.title,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        address: appointments.address,
        customerName: appointments.customerName,
        customerPhone: appointments.customerPhone,
        notes: appointments.notes,
        leadId: appointments.leadId,
        assignedUserId: appointments.assignedUserId,
        color: memberships.color,
        assignedName: users.name,
        createdBy: appointments.createdBy,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.assignedUserId))
      .leftJoin(memberships, and(eq(memberships.userId, appointments.assignedUserId), eq(memberships.companyId, appointments.companyId)))
      .where(
        and(
          gte(appointments.endsAt, start),
          lt(appointments.startsAt, end),
          inArray(appointments.status, ["scheduled", "completed", "no_show"]),
        ),
      );
    const busy = await tx
      .select({ id: busyBlocks.id, userId: busyBlocks.userId, startsAt: busyBlocks.startsAt, endsAt: busyBlocks.endsAt })
      .from(busyBlocks)
      .where(and(gte(busyBlocks.endsAt, start), lt(busyBlocks.startsAt, end)));
    return { appts, busy };
  });
}

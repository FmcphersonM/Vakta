"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { calendarConnections } from "@/lib/db/schema";
import { disconnectCalendar, refreshBusyForConnection } from "@/lib/calendar/sync";
import { audit } from "@/lib/audit";

async function ownConnection(id: string) {
  const ctx = await requireCompany();
  const [conn] = await withTenant(ctx.company.id, (tx) =>
    tx.select().from(calendarConnections).where(and(eq(calendarConnections.id, id), eq(calendarConnections.userId, ctx.user.id))),
  );
  return { ctx, conn };
}

export async function syncCalendarNow(form: FormData) {
  const { conn } = await ownConnection(z.string().uuid().parse(form.get("id")));
  if (conn) await refreshBusyForConnection({ ...conn, status: "active" });
  revalidatePath("/settings/calendar");
}

export async function disconnectCalendarAction(form: FormData) {
  const { ctx, conn } = await ownConnection(z.string().uuid().parse(form.get("id")));
  if (!conn) return;
  await disconnectCalendar(ctx.company.id, conn.id);
  await withTenant(ctx.company.id, (tx) => audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: `calendar.disconnected.${conn.provider}` }));
  revalidatePath("/settings/calendar");
}

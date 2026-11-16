"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { assertManager, requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { companies } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/format";
import { eraseByPhone } from "@/lib/gdpr/erasure";
import { getTelephony } from "@/lib/telephony/provider";
import { deleteCalendarEventsFor } from "@/lib/calendar/sync";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/components/ui/form";

export async function eraseByPhoneAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany();
  assertManager(ctx);
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (!phone) return { error: ctx.t.common.error };
  const tel = await getTelephony();
  const r = await eraseByPhone({
    companyId: ctx.company.id,
    phone,
    userId: ctx.user.id,
    deleteRecording: (sid) => tel.deleteRecording(sid),
    deleteCalendarEvents: (ids) => deleteCalendarEventsFor(ctx.company.id, ids),
  });
  revalidatePath("/", "layout");
  return { ok: true, message: ctx.t.settings.privacy.erased(r.leads + r.calls + r.appointments + r.sms) };
}

export async function requestCompanyDeletion(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany();
  if (ctx.membership.role !== "owner") return { error: ctx.t.common.error };
  if (String(form.get("confirm") ?? "").trim() !== ctx.company.name) return { error: ctx.t.settings.privacy.deleteCompanyConfirm };
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(companies).set({ deletionRequestedAt: new Date() }).where(eq(companies.id, ctx.company.id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "company.deletion_requested" });
  });
  return { ok: true, message: ctx.t.settings.privacy.deleteScheduled };
}

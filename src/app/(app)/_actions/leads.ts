"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { leads, type LeadStatus } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/format";
import { eraseByPhone } from "@/lib/gdpr/erasure";
import { getTelephony } from "@/lib/telephony/provider";
import { deleteCalendarEventsFor } from "@/lib/calendar/sync";
import type { ActionState } from "@/components/ui/form";

const statusSchema = z.enum(["new", "booked", "quoted", "won", "lost"]);

export async function setLeadStatus(form: FormData) {
  const ctx = await requireCompany();
  const id = z.string().uuid().parse(form.get("id"));
  const status = statusSchema.parse(form.get("status")) as LeadStatus;
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(leads).set({ status }).where(eq(leads.id, id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "lead.status", entityType: "lead", entityId: id, metadata: { status } });
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/today");
}

const leadSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  jobTypeText: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  urgency: z.enum(["low", "normal", "high", "emergency"]).optional(),
  preferredTimes: z.string().trim().max(300).optional(),
  valueNok: z.string().trim().optional(),
  notes: z.string().trim().max(4000).optional(),
});

function cleanLead(input: z.infer<typeof leadSchema>) {
  const empty = (v?: string) => (v && v.length ? v : null);
  return {
    name: empty(input.name),
    phone: normalizePhone(input.phone) ?? empty(input.phone),
    email: empty(input.email),
    address: empty(input.address),
    jobTypeText: empty(input.jobTypeText),
    description: empty(input.description),
    urgency: input.urgency ?? "normal",
    preferredTimes: empty(input.preferredTimes),
    valueNok: input.valueNok ? Number(input.valueNok.replace(/\D/g, "")) || null : null,
    notes: empty(input.notes),
  };
}

export async function updateLead(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany();
  const id = z.string().uuid().parse(form.get("id"));
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: ctx.t.common.error };
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(leads).set(cleanLead(parsed.data)).where(eq(leads.id, id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "lead.updated", entityType: "lead", entityId: id });
  });
  revalidatePath(`/leads/${id}`);
  return { ok: true, message: ctx.t.common.saved };
}

export async function createLead(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany();
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: ctx.t.common.error };
  const [row] = await withTenant(ctx.company.id, async (tx) => {
    const r = await tx
      .insert(leads)
      .values({ ...cleanLead(parsed.data), companyId: ctx.company.id, source: "manual" })
      .returning({ id: leads.id });
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "lead.created", entityType: "lead", entityId: r[0].id });
    return r;
  });
  redirect(`/leads/${row.id}`);
}

export async function eraseLeadData(form: FormData) {
  const ctx = await requireCompany();
  const id = z.string().uuid().parse(form.get("id"));
  const lead = await withTenant(ctx.company.id, async (tx) => (await tx.select().from(leads).where(eq(leads.id, id)))[0]);
  if (!lead) redirect("/leads");
  if (lead.phone) {
    const tel = await getTelephony();
    await eraseByPhone({
      companyId: ctx.company.id,
      phone: lead.phone,
      userId: ctx.user.id,
      deleteRecording: (sid) => tel.deleteRecording(sid),
      deleteCalendarEvents: (ids) => deleteCalendarEventsFor(ctx.company.id, ids),
    });
  }
  // A lead without a phone number is just deleted.
  await withTenant(ctx.company.id, async (tx) => {
    await tx.delete(leads).where(eq(leads.id, id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "lead.deleted", entityType: "lead", entityId: id });
  });
  revalidatePath("/leads");
  redirect("/leads");
}

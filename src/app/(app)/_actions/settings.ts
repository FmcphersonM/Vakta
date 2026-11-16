"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { assertManager, requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { companies, invitations, jobTypes, memberships, type BusinessHours } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/format";
import { geocodeAddress } from "@/lib/booking/geocode";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import type { ActionState } from "@/components/ui/form";

async function managerCtx() {
  const ctx = await requireCompany();
  assertManager(ctx);
  return ctx;
}

async function saveCompany(changes: Partial<typeof companies.$inferInsert>, action: string) {
  const ctx = await managerCtx();
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(companies).set(changes).where(eq(companies.id, ctx.company.id));
    await audit(tx, {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action,
      entityType: "company",
      entityId: ctx.company.id,
      metadata: { fields: Object.keys(changes) },
    });
  });
  revalidatePath("/", "layout");
  return ctx;
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
const phones = (v: FormDataEntryValue | null) => lines(v).map((p) => normalizePhone(p)).filter((p): p is string => !!p);

export async function saveBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    orgNumber: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(200).optional(),
    baseAddress: z.string().trim().max(300).optional(),
    serviceRadiusKm: z.coerce.number().int().min(1).max(500),
    trade: z.enum(["plumber", "electrician", "carpenter", "roofer", "painter", "general"]),
  });
  const p = schema.safeParse(Object.fromEntries(form));
  const ctx0 = await requireCompany();
  if (!p.success) return { error: ctx0.t.common.error };
  let geo = null;
  if (p.data.baseAddress && p.data.baseAddress !== ctx0.company.baseAddress) {
    geo = await geocodeAddress(p.data.baseAddress);
    if (!geo) return { error: ctx0.t.settings.business.addressNotFound };
  }
  const ctx = await saveCompany(
    {
      name: p.data.name,
      orgNumber: p.data.orgNumber || null,
      phone: normalizePhone(p.data.phone) ?? null,
      email: p.data.email || null,
      trade: p.data.trade,
      serviceRadiusKm: p.data.serviceRadiusKm,
      servicePostcodes: lines(form.get("servicePostcodes")).filter((x) => /^\d{2,4}$/.test(x)),
      ...(geo ? { baseAddress: geo.address, baseLat: geo.lat, baseLng: geo.lng } : p.data.baseAddress ? {} : { baseAddress: null, baseLat: null, baseLng: null }),
    },
    "settings.business",
  );
  return { ok: true, message: geo ? ctx.t.settings.business.addressFound(geo.address) : ctx.t.common.saved };
}

export async function saveHours(_: ActionState, form: FormData): Promise<ActionState> {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const hours = {} as BusinessHours;
  for (const d of ["1", "2", "3", "4", "5", "6", "7"] as const) {
    const open = form.get(`open_${d}`) === "on";
    const start = String(form.get(`start_${d}`) ?? "");
    const end = String(form.get(`end_${d}`) ?? "");
    hours[d] = open && hhmm.test(start) && hhmm.test(end) && start < end ? [{ start, end }] : [];
  }
  const schema = z.object({
    befaringMinutes: z.coerce.number().int().min(15).max(480),
    bufferMinutes: z.coerce.number().int().min(0).max(240),
    minNoticeHours: z.coerce.number().int().min(0).max(168),
    bookingHorizonDays: z.coerce.number().int().min(1).max(120),
  });
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: (await requireCompany()).t.common.error };
  const ctx = await saveCompany({ businessHours: hours, ...p.data }, "settings.hours");
  return { ok: true, message: ctx.t.common.saved };
}

export async function saveAgent(_: ActionState, form: FormData): Promise<ActionState> {
  const schema = z.object({
    greetingText: z.string().trim().min(1).max(300),
    agentInstructions: z.string().trim().max(3000),
    recordingRetentionDays: z.coerce.number().int().min(1).max(3650),
    transcriptRetentionDays: z.coerce.number().int().min(30).max(3650),
    locale: z.enum(["nb", "en"]),
    smsSenderName: z.string().trim().regex(/^[A-Za-z0-9 ]{0,11}$/),
  });
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: (await requireCompany()).t.common.error };
  const ctx = await saveCompany(
    { ...p.data, smsSenderName: p.data.smsSenderName || null, recordingEnabled: form.get("recordingEnabled") === "on", sendReminders: form.get("sendReminders") === "on" },
    "settings.agent",
  );
  return { ok: true, message: ctx.t.common.saved };
}

export async function saveForwarding(_: ActionState, form: FormData): Promise<ActionState> {
  const forwardNumber = normalizePhone(String(form.get("forwardNumber") ?? ""));
  const forwardHours = z.enum(["always", "business_hours", "outside_business_hours"]).parse(form.get("forwardHours"));
  const notifyOn = ["booked", "lead", "emergency", "missed"].filter((k) => form.get(`notify_${k}`) === "on");
  const ctx = await saveCompany(
    {
      forwardEmergencies: form.get("forwardEmergencies") === "on",
      forwardOnRequest: form.get("forwardOnRequest") === "on",
      forwardNumber,
      forwardHours,
      vipNumbers: phones(form.get("vipNumbers")),
      blockedNumbers: phones(form.get("blockedNumbers")),
      notifyNumbers: phones(form.get("notifyNumbers")),
      notifyOn,
    },
    "settings.forwarding",
  );
  return { ok: true, message: ctx.t.common.saved };
}

export async function saveRequire2fa(form: FormData) {
  const ctx = await requireCompany("no2fa");
  if (ctx.membership.role !== "owner") throw new Error("forbidden");
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(companies).set({ require2fa: form.get("require2fa") === "on" }).where(eq(companies.id, ctx.company.id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "settings.require_2fa", metadata: { on: form.get("require2fa") === "on" } });
  });
  revalidatePath("/settings/security");
}

// ── Services (job types) ─────────────────────────────────────────────────────
const jobSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  befaringMinutes: z.string().optional(),
});

export async function saveJobType(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await managerCtx();
  const p = jobSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: ctx.t.common.error };
  const id = form.get("id") ? z.string().uuid().parse(form.get("id")) : null;
  const mins = p.data.befaringMinutes ? Number(p.data.befaringMinutes) : null;
  const values = {
    name: p.data.name,
    description: p.data.description ?? "",
    befaringMinutes: mins && mins >= 15 && mins <= 480 ? mins : null,
    needsBefaring: form.get("needsBefaring") === "on",
    active: form.get("active") === "on",
  };
  await withTenant(ctx.company.id, async (tx) => {
    if (id) await tx.update(jobTypes).set(values).where(eq(jobTypes.id, id));
    else await tx.insert(jobTypes).values({ ...values, companyId: ctx.company.id, sort: 100 });
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: id ? "job_type.updated" : "job_type.created", entityType: "job_type", entityId: id ?? undefined });
  });
  revalidatePath("/settings/services");
  return { ok: true, message: ctx.t.common.saved };
}

export async function deleteJobType(form: FormData) {
  const ctx = await managerCtx();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(ctx.company.id, async (tx) => {
    await tx.delete(jobTypes).where(eq(jobTypes.id, id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "job_type.deleted", entityType: "job_type", entityId: id });
  });
  revalidatePath("/settings/services");
}

// ── Team ─────────────────────────────────────────────────────────────────────
export async function inviteMember(_: ActionState, form: FormData): Promise<ActionState & { link?: string }> {
  const ctx = await managerCtx();
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  const role = z.enum(["admin", "member"]).safeParse(form.get("role"));
  if (!email.success || !role.success) return { error: ctx.t.common.error };
  const token = randomToken(24);
  await withTenant(ctx.company.id, async (tx) => {
    await tx.insert(invitations).values({
      companyId: ctx.company.id,
      email: email.data,
      role: role.data,
      tokenHash: sha256(token),
      invitedBy: ctx.user.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    });
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "team.invited", metadata: { role: role.data } });
  });
  const link = `${env().APP_URL}/invite/${token}`;
  await sendEmail({
    to: email.data,
    subject: `${ctx.user.name} har invitert deg til ${ctx.company.name}`,
    text: `Hei!\n\n${ctx.user.name} har invitert deg til ${ctx.company.name} i ${env().NEXT_PUBLIC_APP_NAME}.\n\nBli med her (gyldig i 7 dager):\n${link}`,
  }).catch((e) => console.error("[invite] email failed", e));
  revalidatePath("/settings/team");
  return { ok: true, message: ctx.t.settings.team.inviteCreated, link };
}

export async function updateMember(form: FormData) {
  const ctx = await managerCtx();
  const userId = z.string().uuid().parse(form.get("userId"));
  const role = z.enum(["owner", "admin", "member"]).parse(form.get("role"));
  const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).parse(form.get("color"));
  if (role === "owner" && ctx.membership.role !== "owner") throw new Error("forbidden");
  await withTenant(ctx.company.id, async (tx) => {
    // Never leave a company without an owner.
    if (userId === ctx.user.id && role !== "owner" && ctx.membership.role === "owner") {
      const owners = await tx.select().from(memberships).where(eq(memberships.role, "owner"));
      if (owners.length <= 1) return;
    }
    await tx
      .update(memberships)
      .set({ role, color, doesBefaring: form.get("doesBefaring") === "on" })
      .where(eq(memberships.userId, userId));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "team.updated", entityType: "user", entityId: userId, metadata: { role } });
  });
  revalidatePath("/settings/team");
}

export async function removeMember(form: FormData) {
  const ctx = await managerCtx();
  const userId = z.string().uuid().parse(form.get("userId"));
  if (userId === ctx.user.id) return;
  await withTenant(ctx.company.id, async (tx) => {
    await tx.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.companyId, ctx.company.id)));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "team.removed", entityType: "user", entityId: userId });
  });
  revalidatePath("/settings/team");
}

export async function revokeInvite(form: FormData) {
  const ctx = await managerCtx();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(ctx.company.id, (tx) => tx.delete(invitations).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt))));
  revalidatePath("/settings/team");
}

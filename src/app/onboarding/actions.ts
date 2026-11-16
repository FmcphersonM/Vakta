"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, inArray, not } from "drizzle-orm";
import { z } from "zod";
import { assertManager, requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { companies, jobTypes, users, type BusinessHours } from "@/lib/db/schema";
import { geocodeAddress } from "@/lib/booking/geocode";
import { normalizePhone } from "@/lib/format";
import { assignNumber } from "@/lib/telephony/numbers";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import type { ActionState } from "@/components/ui/form";

const ORDER = ["business", "services", "hours", "phone", "test", "done"] as const;
type Step = (typeof ORDER)[number];

async function ctxForOnboarding() {
  const ctx = await requireCompany("onboarding");
  assertManager(ctx);
  return ctx;
}

async function advance(companyId: string, from: Step, changes: Partial<typeof companies.$inferInsert> = {}) {
  await withTenant(companyId, async (tx) => {
    const [c] = await tx.select({ step: companies.onboardingStep }).from(companies).where(eq(companies.id, companyId));
    const next = ORDER[Math.max(ORDER.indexOf(c.step as Step), ORDER.indexOf(from) + 1)];
    await tx.update(companies).set({ ...changes, onboardingStep: next }).where(eq(companies.id, companyId));
    await audit(tx, { companyId, action: `onboarding.${from}` });
  });
  revalidatePath("/onboarding");
  redirect("/onboarding");
}

export async function saveBusinessStep(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await ctxForOnboarding();
  const p = z
    .object({
      name: z.string().trim().min(2).max(100),
      orgNumber: z.string().trim().max(20).optional(),
      baseAddress: z.string().trim().min(3).max(300),
      serviceRadiusKm: z.coerce.number().int().min(1).max(500),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: ctx.t.common.error };
  const geo = await geocodeAddress(p.data.baseAddress);
  if (!geo) return { error: ctx.t.settings.business.addressNotFound };
  await advance(ctx.company.id, "business", {
    name: p.data.name,
    orgNumber: p.data.orgNumber || null,
    baseAddress: geo.address,
    baseLat: geo.lat,
    baseLng: geo.lng,
    serviceRadiusKm: p.data.serviceRadiusKm,
  });
  return null;
}

export async function saveServicesStep(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await ctxForOnboarding();
  const keep = form.getAll("keep").map(String).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  const extra = String(form.get("extra") ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 20);
  const minutes = z.coerce.number().int().min(15).max(480).catch(45).parse(form.get("befaringMinutes"));
  await withTenant(ctx.company.id, async (tx) => {
    if (keep.length) await tx.update(jobTypes).set({ active: false }).where(not(inArray(jobTypes.id, keep)));
    else await tx.update(jobTypes).set({ active: false });
    if (extra.length) await tx.insert(jobTypes).values(extra.map((name, i) => ({ companyId: ctx.company.id, name, sort: 50 + i })));
  });
  await advance(ctx.company.id, "services", { befaringMinutes: minutes });
  return null;
}

export async function saveHoursStep(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await ctxForOnboarding();
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const hours = {} as BusinessHours;
  for (const d of ["1", "2", "3", "4", "5", "6", "7"] as const) {
    const open = form.get(`open_${d}`) === "on";
    const start = String(form.get(`start_${d}`) ?? "");
    const end = String(form.get(`end_${d}`) ?? "");
    hours[d] = open && hhmm.test(start) && hhmm.test(end) && start < end ? [{ start, end }] : [];
  }
  if (!Object.values(hours).some((r) => r.length)) return { error: ctx.t.common.error };
  await advance(ctx.company.id, "hours", { businessHours: hours });
  return null;
}

export async function savePhoneStep(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await ctxForOnboarding();
  const mobile = normalizePhone(String(form.get("mobile") ?? ""));
  if (!mobile) return { error: ctx.t.common.error };
  try {
    await assignNumber(ctx.company.id, ctx.user.id);
  } catch (e) {
    console.error("[onboarding] number", e);
    return { error: ctx.t.common.error };
  }
  if (!ctx.user.phone) await getDb().update(users).set({ phone: mobile }).where(eq(users.id, ctx.user.id));
  await advance(ctx.company.id, "phone", { forwardNumber: mobile, notifyNumbers: [mobile], phone: ctx.company.phone ?? mobile });
  return null;
}

export async function finishOnboarding() {
  const ctx = await ctxForOnboarding();
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(companies).set({ onboardingStep: "done" }).where(eq(companies.id, ctx.company.id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "onboarding.done" });
  });
  redirect("/today");
}

export async function goToStep(form: FormData) {
  const ctx = await ctxForOnboarding();
  const step = z.enum(["business", "services", "hours", "phone", "test"]).parse(form.get("step"));
  if (ORDER.indexOf(step) <= ORDER.indexOf(ctx.company.onboardingStep as Step)) {
    await withTenant(ctx.company.id, (tx) => tx.update(companies).set({ onboardingStep: step }).where(eq(companies.id, ctx.company.id)));
  }
  redirect("/onboarding");
}

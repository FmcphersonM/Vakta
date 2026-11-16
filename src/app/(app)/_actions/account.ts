"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getCurrentSession, requireCompany } from "@/lib/auth/current";
import { getDb, withTenant } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { generateBackupCodes, generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { deleteOtherSessions } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { LOCALE_COOKIE } from "@/lib/i18n";
import type { ActionState } from "@/components/ui/form";

export async function setMyLocale(locale: "nb" | "en") {
  const cur = await getCurrentSession();
  if (!cur) return;
  const l = locale === "en" ? "en" : "nb";
  await getDb().update(users).set({ locale: l }).where(eq(users.id, cur.user.id));
  (await cookies()).set(LOCALE_COOKIE, l, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Step 1: create a secret (not active yet) and return a QR code for the app. */
export async function startTwoFactor(): Promise<{ secret: string; qr: string }> {
  const ctx = await requireCompany("no2fa");
  if (ctx.user.totpEnabledAt) throw new Error("already_enabled");
  const secret = generateTotpSecret();
  await getDb().update(users).set({ totpSecretEnc: encrypt(secret) }).where(eq(users.id, ctx.user.id));
  const uri = otpauthUri(secret, ctx.user.email, env().NEXT_PUBLIC_APP_NAME);
  return { secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** Step 2: prove the app works; then 2FA is on and backup codes are shown once. */
export async function confirmTwoFactor(_: ActionState, form: FormData): Promise<ActionState & { backupCodes?: string[] }> {
  const ctx = await requireCompany("no2fa");
  const [u] = await getDb().select().from(users).where(eq(users.id, ctx.user.id));
  if (!u?.totpSecretEnc) return { error: ctx.t.common.error };
  if (!verifyTotp(decrypt(u.totpSecretEnc), String(form.get("code") ?? ""))) return { error: ctx.t.auth.invalidCode };
  const codes = generateBackupCodes();
  await getDb().update(users).set({ totpEnabledAt: new Date(), backupCodes: codes.hashed }).where(eq(users.id, ctx.user.id));
  await deleteOtherSessions(ctx.user.id, ctx.sessionId);
  await withTenant(ctx.company.id, (tx) => audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "security.2fa_enabled" }));
  revalidatePath("/", "layout");
  return { ok: true, message: ctx.t.settings.security.enabled, backupCodes: codes.plain };
}

export async function disableTwoFactor(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany("no2fa");
  if (ctx.company.require2fa) return { error: ctx.t.settings.security.enforced };
  if (!(await verifyPassword(String(form.get("password") ?? ""), ctx.user.passwordHash))) return { error: ctx.t.settings.security.wrongPassword };
  await getDb().update(users).set({ totpEnabledAt: null, totpSecretEnc: null, backupCodes: [] }).where(eq(users.id, ctx.user.id));
  await withTenant(ctx.company.id, (tx) => audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "security.2fa_disabled" }));
  revalidatePath("/", "layout");
  return { ok: true, message: ctx.t.settings.security.disabled };
}

export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireCompany("no2fa");
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (!(await verifyPassword(current, ctx.user.passwordHash))) return { error: ctx.t.settings.security.wrongPassword };
  if (passwordProblem(next)) return { error: ctx.t.auth.passwordTooShort };
  await getDb().update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, ctx.user.id));
  await deleteOtherSessions(ctx.user.id, ctx.sessionId);
  await withTenant(ctx.company.id, (tx) => audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "security.password_changed" }));
  return { ok: true, message: ctx.t.settings.security.passwordChanged };
}

export async function logoutOtherDevices(): Promise<ActionState> {
  const ctx = await requireCompany("no2fa");
  await deleteOtherSessions(ctx.user.id, ctx.sessionId);
  return { ok: true, message: ctx.t.settings.security.loggedOutOthers };
}

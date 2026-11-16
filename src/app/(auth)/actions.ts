"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { authenticate, verifySecondFactor } from "@/lib/auth/login";
import {
  completeMfa,
  createSession,
  deleteOtherSessions,
  deleteSession,
  SESSION_COOKIE,
} from "@/lib/auth/sessions";
import { clearSessionCookie, clientIp, getCurrentSession, publicLocale, setSessionCookie } from "@/lib/auth/current";
import { EmailTakenError, signup } from "@/lib/auth/signup";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { getDb, withSystem } from "@/lib/db/client";
import { memberships, passwordResets, users } from "@/lib/db/schema";
import { dict } from "@/lib/i18n";
import { TRADES } from "@/lib/trades";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { ActionState } from "@/components/ui/form";

async function firstCompanyId(userId: string): Promise<string | null> {
  const rows = await withSystem((tx) =>
    tx
      .select({ companyId: memberships.companyId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt))
      .limit(1),
  );
  return rows[0]?.companyId ?? null;
}

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const t = dict(await publicLocale());
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  const result = await authenticate(email, password, ip);
  if (!result.ok) return { error: result.reason === "rate_limited" ? t.auth.rateLimited : t.auth.invalid };
  const { token, expiresAt } = await createSession({
    userId: result.user.id,
    companyId: await firstCompanyId(result.user.id),
    mfaPending: result.needsMfa,
    ip,
    userAgent: null,
  });
  await setSessionCookie(token, expiresAt);
  redirect(result.needsMfa ? "/login/verify" : "/today");
}

export async function verifyMfaAction(_: ActionState, form: FormData): Promise<ActionState> {
  const t = dict(await publicLocale());
  const cur = await getCurrentSession();
  if (!cur) redirect("/login");
  const ok = await verifySecondFactor(cur.user.id, String(form.get("code") ?? ""));
  if (!ok) return { error: t.auth.invalidCode };
  const { expiresAt } = await completeMfa(cur.session.id);
  const token = (await cookies()).get(SESSION_COOKIE)!.value;
  await setSessionCookie(token, expiresAt);
  redirect("/today");
}

const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  password: z.string(),
  trade: z.enum(TRADES),
  accept: z.literal("on"),
});

export async function signupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const locale = await publicLocale();
  const t = dict(locale);
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.accept) return { error: t.auth.mustAccept };
    return { error: t.common.error, fieldErrors: Object.fromEntries(Object.keys(fields).map((k) => [k, t.common.error])) };
  }
  if (passwordProblem(parsed.data.password)) return { error: t.auth.passwordTooShort };
  const ip = await clientIp();
  let ids: { companyId: string; userId: string };
  try {
    ids = await signup({ ...parsed.data, locale, ip });
  } catch (e) {
    if (e instanceof EmailTakenError) return { error: t.auth.emailTaken };
    throw e;
  }
  const { token, expiresAt } = await createSession({ userId: ids.userId, companyId: ids.companyId, mfaPending: false, ip });
  await setSessionCookie(token, expiresAt);
  redirect("/onboarding");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const t = dict(await publicLocale());
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const token = randomToken(32);
    await getDb()
      .insert(passwordResets)
      .values({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
    const link = `${env().APP_URL}/reset/${token}`;
    await sendEmail({
      to: user.email,
      subject: user.locale === "en" ? "Reset your password" : "Tilbakestill passordet ditt",
      text:
        user.locale === "en"
          ? `Hi ${user.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email.`
          : `Hei ${user.name},\n\nBruk denne lenken for å velge nytt passord (gyldig i 1 time):\n${link}\n\nHvis du ikke ba om dette, kan du se bort fra e-posten.`,
    });
  }
  return { ok: true, message: t.auth.linkSent };
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const t = dict(await publicLocale());
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (passwordProblem(password)) return { error: t.auth.passwordTooShort };
  const db = getDb();
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, sha256(token)), gt(passwordResets.expiresAt, new Date()), isNull(passwordResets.usedAt)))
    .limit(1);
  if (!row) return { error: t.auth.resetInvalid };
  await db.update(users).set({ passwordHash: await hashPassword(password), failedLogins: 0 }).where(eq(users.id, row.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.tokenHash, row.tokenHash));
  await deleteOtherSessions(row.userId);
  return { ok: true, message: t.auth.resetDone };
}

import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadSession, SESSION_COOKIE } from "./sessions";
import { withTenant } from "../db/client";
import { companies, memberships, type Company, type Membership, type User } from "../db/schema";
import { dict, asLocale, LOCALE_COOKIE, type Locale } from "../i18n";

export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return loadSession(token);
});

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Locale for pages without a logged-in user. */
export async function publicLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (c) return asLocale(c);
  const al = (await headers()).get("accept-language") ?? "";
  return /^en/i.test(al) && !/nb|no|nn/i.test(al) ? "en" : "nb";
}

export async function requireUser() {
  const cur = await getCurrentSession();
  if (!cur) redirect("/login");
  if (cur.session.mfaPending) redirect("/login/verify");
  return cur;
}

export type AppContext = {
  user: User;
  sessionId: string;
  company: Company;
  membership: Membership;
  locale: Locale;
  t: ReturnType<typeof dict>;
};

/**
 * Every dashboard page calls this. It loads the company through row-level
 * security, so a session can only ever reach its own company.
 */
export const requireCompany = cache(
  async (mode: "default" | "onboarding" | "no2fa" = "default"): Promise<AppContext> => {
    const opts = { allowOnboarding: mode === "onboarding", allowWithout2fa: mode !== "default" };
    const { user, session } = await requireUser();
    if (!session.companyId) redirect("/signup");
    const companyId = session.companyId;
    const data = await withTenant(companyId, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.companyId, companyId), eq(memberships.userId, user.id)))
        .limit(1);
      return { company, membership };
    });
    if (!data.company || !data.membership) redirect("/login");
    if (data.company.require2fa && !user.totpEnabledAt && !opts.allowWithout2fa) redirect("/settings/security?enforce=1");
    if (data.company.onboardingStep !== "done" && !opts.allowOnboarding) redirect("/onboarding");
    const locale = asLocale(user.locale);
    return { user, sessionId: session.id, company: data.company, membership: data.membership, locale, t: dict(locale) };
  },
);

export function canManage(ctx: AppContext) {
  return ctx.membership.role === "owner" || ctx.membership.role === "admin";
}

export function assertManager(ctx: AppContext) {
  if (!canManage(ctx)) throw new Error("forbidden");
}

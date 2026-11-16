"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { withSystem } from "@/lib/db/client";
import { invitations, memberships, users } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { createSession, setSessionCompany } from "@/lib/auth/sessions";
import { clientIp, getCurrentSession, publicLocale, setSessionCookie } from "@/lib/auth/current";
import { audit } from "@/lib/audit";
import { dict } from "@/lib/i18n";
import type { ActionState } from "@/components/ui/form";

export async function findInvite(token: string) {
  return withSystem(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    return inv ?? null;
  });
}

export async function acceptInvite(_: ActionState, form: FormData): Promise<ActionState> {
  const t = dict(await publicLocale());
  const token = String(form.get("token") ?? "");
  const inv = await findInvite(token);
  if (!inv) return { error: t.auth.inviteInvalid };
  const cur = await getCurrentSession();
  const ip = await clientIp();

  let userId: string;
  if (cur && cur.user.email.toLowerCase() === inv.email.toLowerCase()) {
    userId = cur.user.id;
  } else {
    const name = String(form.get("name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (name.length < 2) return { error: t.common.error };
    if (passwordProblem(password)) return { error: t.auth.passwordTooShort };
    const existing = await withSystem((tx) => tx.select().from(users).where(eq(users.email, inv.email)));
    if (existing.length) return { error: t.auth.emailTaken };
    const [u] = await withSystem(async (tx) =>
      tx.insert(users).values({ email: inv.email, name, passwordHash: await hashPassword(password) }).returning(),
    );
    userId = u.id;
  }

  await withSystem(async (tx) => {
    await tx.insert(memberships).values({ companyId: inv.companyId, userId, role: inv.role }).onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit(tx, { companyId: inv.companyId, userId, action: "team.joined", entityType: "user", entityId: userId, ip });
  });

  if (cur && cur.user.id === userId) {
    await setSessionCompany(cur.session.id, inv.companyId);
  } else {
    const { token: st, expiresAt } = await createSession({ userId, companyId: inv.companyId, mfaPending: false, ip });
    await setSessionCookie(st, expiresAt);
  }
  redirect("/today");
}

import { and, eq, gt, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { sessions, users, type User } from "../db/schema";
import { randomToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "vakta_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const MFA_PENDING_TTL_MS = 10 * 60 * 1000;

export type SessionRow = typeof sessions.$inferSelect;

export async function createSession(input: {
  userId: string;
  companyId: string | null;
  mfaPending: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (input.mfaPending ? MFA_PENDING_TTL_MS : SESSION_TTL_MS));
  await getDb()
    .insert(sessions)
    .values({
      id: sha256(token),
      userId: input.userId,
      companyId: input.companyId,
      mfaPending: input.mfaPending,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    });
  return { token, expiresAt };
}

export async function loadSession(token: string | undefined | null): Promise<{ session: SessionRow; user: User } | null> {
  if (!token) return null;
  const id = sha256(token);
  const rows = await getDb()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Sliding expiry, at most one write per 10 minutes.
  if (!row.session.mfaPending && Date.now() - row.session.lastSeenAt.getTime() > 10 * 60 * 1000) {
    await getDb()
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
  }
  return row;
}

export async function completeMfa(sessionId: string): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().update(sessions).set({ mfaPending: false, expiresAt, lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
  return { expiresAt };
}

export async function setSessionCompany(sessionId: string, companyId: string) {
  await getDb().update(sessions).set({ companyId }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(token: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sha256(token)));
}

/** Log out everywhere else (after password change or 2FA change). */
export async function deleteOtherSessions(userId: string, keepSessionId?: string) {
  await getDb()
    .delete(sessions)
    .where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId));
}

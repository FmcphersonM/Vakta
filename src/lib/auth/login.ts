import { and, count, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { loginAttempts, users, type User } from "../db/schema";
import { burnPasswordCheck, verifyPassword } from "./password";
import { decrypt, sha256 } from "../crypto";
import { normalizeBackupCode, verifyTotp } from "./totp";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 30;

export async function isRateLimited(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const db = getDb();
  const [byEmail] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
  if ((byEmail?.n ?? 0) >= MAX_FAILS_PER_EMAIL) return true;
  if (ip) {
    const [byIp] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    if ((byIp?.n ?? 0) >= MAX_FAILS_PER_IP) return true;
  }
  return false;
}

export type LoginResult =
  | { ok: true; user: User; needsMfa: boolean }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function authenticate(emailRaw: string, password: string, ip: string | null): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (await isRateLimited(email, ip)) return { ok: false, reason: "rate_limited" };
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let ok = false;
  if (user) ok = await verifyPassword(password, user.passwordHash);
  else await burnPasswordCheck(password);
  await db.insert(loginAttempts).values({ email, ip, success: ok });
  if (!ok || !user) return { ok: false, reason: "invalid" };
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true, user, needsMfa: Boolean(user.totpEnabledAt && user.totpSecretEnc) };
}

/** Accepts a 6-digit authenticator code or a one-time backup code (consumed). */
export async function verifySecondFactor(userId: string, code: string): Promise<boolean> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.totpSecretEnc || !user.totpEnabledAt) return false;
  const digits = code.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) return verifyTotp(decrypt(user.totpSecretEnc), digits);
  const hashed = sha256(normalizeBackupCode(code));
  if (!user.backupCodes.includes(hashed)) return false;
  await db
    .update(users)
    .set({ backupCodes: sql`array_remove(${users.backupCodes}, ${hashed})` })
    .where(eq(users.id, userId));
  return true;
}

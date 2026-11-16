import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getSql, withSystem } from "../db/client";
import { calls, companies, loginAttempts, passwordResets, phoneNumbers, sessions } from "../db/schema";
import { refreshAllCalendars } from "../calendar/sync";
import { postCall } from "../calls/post-call";
import { getTelephony } from "../telephony/provider";
import { replenishPool } from "../telephony/numbers";
import { audit } from "../audit";

/** Run `fn` only if no other server instance is running the same job right now. */
async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T | "skipped"> {
  const sqlc = getSql();
  const reserved = await sqlc.reserve();
  try {
    const [{ locked }] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext(${`vakta:${name}`})) as locked`;
    if (!locked) return "skipped";
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(hashtext(${`vakta:${name}`}))`;
    }
  } finally {
    reserved.release();
  }
}

/** Calls whose post-processing never ran (e.g. the server restarted mid-call). */
async function sweepPostCalls() {
  const stale = await withSystem((tx) =>
    tx
      .select({ id: calls.id, companyId: calls.companyId })
      .from(calls)
      .where(and(isNull(calls.postProcessedAt), lt(calls.startedAt, new Date(Date.now() - 20 * 60_000))))
      .limit(100),
  );
  for (const c of stale) await postCall(c.id, c.companyId).catch((e) => console.error("[jobs] post-call", e));
  return stale.length;
}

/** GDPR retention: delete recordings and transcripts older than each company allows. */
export async function applyRetention(now = new Date()) {
  const tel = await getTelephony();
  const recordings = await withSystem((tx) =>
    tx
      .select({ id: calls.id, sid: calls.recordingSid, companyId: calls.companyId })
      .from(calls)
      .innerJoin(companies, eq(companies.id, calls.companyId))
      .where(
        and(
          isNotNull(calls.recordingSid),
          isNull(calls.recordingDeletedAt),
          sql`${calls.startedAt} < ${now.toISOString()}::timestamptz - make_interval(days => ${companies.recordingRetentionDays})`,
        ),
      )
      .limit(500),
  );
  for (const r of recordings) {
    try {
      await tel.deleteRecording(r.sid!);
      await withSystem((tx) => tx.update(calls).set({ recordingSid: null, recordingDeletedAt: now }).where(eq(calls.id, r.id)));
    } catch (e) {
      console.error("[retention] recording delete failed", e);
    }
  }
  const old = await withSystem((tx) =>
    tx
      .delete(calls)
      .where(
        sql`${calls.id} in (select c.id from calls c join companies co on co.id = c.company_id
             where c.started_at < ${now.toISOString()}::timestamptz - make_interval(days => co.transcript_retention_days)
               and c.recording_sid is null)`,
      )
      .returning({ id: calls.id }),
  );
  return { recordings: recordings.length, calls: old.length };
}

/** Companies that asked to be deleted more than 30 days ago are removed for good. */
async function purgeDeletedCompanies(now = new Date()) {
  const due = await withSystem((tx) =>
    tx.select().from(companies).where(and(isNotNull(companies.deletionRequestedAt), lt(companies.deletionRequestedAt, new Date(now.getTime() - 30 * 86400_000)))),
  );
  const tel = await getTelephony();
  for (const c of due) {
    const recs = await withSystem((tx) => tx.select({ sid: calls.recordingSid }).from(calls).where(and(eq(calls.companyId, c.id), isNotNull(calls.recordingSid))));
    for (const r of recs) await tel.deleteRecording(r.sid!).catch(() => undefined);
    await withSystem(async (tx) => {
      await tx.update(phoneNumbers).set({ companyId: null, status: "available", assignedAt: null }).where(eq(phoneNumbers.companyId, c.id));
      await audit(tx, { companyId: null, actor: "system", action: "company.purged", entityType: "company", entityId: c.id });
      await tx.delete(companies).where(eq(companies.id, c.id));
    });
  }
  return due.length;
}

async function housekeeping() {
  await withSystem(async (tx) => {
    await tx.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    await tx.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 86400_000)));
    await tx.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date(Date.now() - 86400_000)));
  });
}

export const JOBS = {
  calendars: { everyMs: 10 * 60_000, run: () => refreshAllCalendars() },
  "post-calls": { everyMs: 5 * 60_000, run: () => sweepPostCalls() },
  retention: { everyMs: 60 * 60_000, run: () => applyRetention() },
  "number-pool": { everyMs: 60 * 60_000, run: () => replenishPool() },
  "purge-companies": { everyMs: 6 * 60 * 60_000, run: () => purgeDeletedCompanies() },
  housekeeping: { everyMs: 6 * 60 * 60_000, run: () => housekeeping() },
} as const;
export type JobName = keyof typeof JOBS;

export async function runJob(name: JobName) {
  return exclusive<unknown>(name, JOBS[name].run as () => Promise<unknown>);
}

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "../env";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Next.js (bundled) and server.ts (unbundled) live in the same process; keep
// one connection pool for both by caching it on globalThis.
const g = globalThis as unknown as { __vaktaSql?: postgres.Sql; __vaktaDb?: Db };

export function getSql(): postgres.Sql {
  if (!g.__vaktaSql) {
    g.__vaktaSql = postgres(env().DATABASE_URL, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return g.__vaktaSql;
}

export function getDb(): Db {
  if (!g.__vaktaDb) g.__vaktaDb = drizzle(getSql(), { schema });
  return g.__vaktaDb;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run queries as one company. Row-level security makes every other company's
 * rows invisible inside `fn`, even if a query forgets a WHERE clause.
 */
export async function withTenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!companyId) throw new Error("withTenant: companyId is required");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

/**
 * Trusted system context (inbound-call routing, webhooks, cron jobs, signup).
 * Use sparingly and always filter by company explicitly.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system', 'on', true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  if (g.__vaktaSql) {
    await g.__vaktaSql.end({ timeout: 5 });
    g.__vaktaSql = undefined;
    g.__vaktaDb = undefined;
  }
}

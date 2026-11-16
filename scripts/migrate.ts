/**
 * Applies db/migrations/*.sql in order (each in its own transaction).
 *   pnpm db:migrate            apply new migrations
 *   pnpm db:migrate --reset    DEV ONLY: drop everything and re-apply
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadEnvFile } from "./load-env";

loadEnvFile();

export async function migrate(databaseUrl: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const log = (m: string) => !opts.quiet && console.log(m);
  try {
    if (opts.reset) {
      if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
      await sql.unsafe("DROP OWNED BY CURRENT_USER CASCADE");
      log("• database reset");
    }
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await sql<{ version: string }[]>`SELECT version FROM schema_migrations`).map((r) => r.version));
    const dir = path.resolve(import.meta.dirname, "../db/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (version) VALUES (${file})`;
      });
      log(`• applied ${file}`);
    }
    log("✓ database is up to date");
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (copy .env.example to .env)");
    process.exit(1);
  }
  migrate(url, { reset: process.argv.includes("--reset") }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { closeDb, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

afterAll(closeDb);

describe("Drizzle schema matches the SQL migrations", () => {
  it("every declared column exists in the database", async () => {
    const rows = await getDb().execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const actual = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      if (value && typeof value === "object" && Symbol.for("drizzle:IsDrizzleTable") in value) {
        const cfg = getTableConfig(value as PgTable);
        for (const col of cfg.columns) {
          if (!actual.has(`${cfg.name}.${col.name}`)) missing.push(`${cfg.name}.${col.name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

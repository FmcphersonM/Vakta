import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { calls, companies } from "@/lib/db/schema";
import { applyRetention, runJob } from "@/lib/jobs";
import { setTelephonyForTests, type TelephonyProvider } from "@/lib/telephony/provider";
import { makeCompany } from "./helpers";

afterAll(async () => {
  setTelephonyForTests(undefined);
  await closeDb();
});

describe("GDPR retention job", () => {
  it("deletes recordings at the provider after the retention period, and old transcripts entirely", async () => {
    const deleted: string[] = [];
    setTelephonyForTests({
      name: "mock",
      deleteRecording: async (sid: string) => void deleted.push(sid),
    } as unknown as TelephonyProvider);
    const c = await makeCompany();
    await withSystem((tx) => tx.update(companies).set({ recordingRetentionDays: 30, transcriptRetentionDays: 365 }).where(eq(companies.id, c.companyId)));
    const day = 86400_000;
    const [fresh, oldRec, ancient] = await withTenant(c.companyId, (tx) =>
      tx
        .insert(calls)
        .values([
          { companyId: c.companyId, startedAt: new Date(Date.now() - 5 * day), recordingSid: "RE-fresh" },
          { companyId: c.companyId, startedAt: new Date(Date.now() - 40 * day), recordingSid: "RE-old" },
          { companyId: c.companyId, startedAt: new Date(Date.now() - 400 * day) },
        ])
        .returning(),
    );
    const r = await applyRetention();
    expect(r.recordings).toBeGreaterThanOrEqual(1);
    expect(deleted).toContain("RE-old");
    expect(deleted).not.toContain("RE-fresh");
    const rows = await withTenant(c.companyId, (tx) => tx.select().from(calls));
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(byId[fresh.id].recordingSid).toBe("RE-fresh");
    expect(byId[oldRec.id].recordingSid).toBeNull();
    expect(byId[oldRec.id].recordingDeletedAt).not.toBeNull();
    expect(byId[ancient.id]).toBeUndefined();
  });

  it("runs jobs behind a lock", async () => {
    const [a, b] = await Promise.all([runJob("housekeeping"), runJob("housekeeping")]);
    expect([a, b]).toContain("skipped");
  });
});

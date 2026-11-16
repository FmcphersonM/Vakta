import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb, withSystem, withTenant } from "@/lib/db/client";
import { auditLogs, companies, leads } from "@/lib/db/schema";
import { makeCompany } from "./helpers";
import { authenticate, MAX_FAILS_PER_EMAIL } from "@/lib/auth/login";

afterAll(closeDb);

describe("multi-tenant isolation (row-level security)", () => {
  it("a company never sees another company's rows, even without WHERE", async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    await withTenant(a.companyId, (tx) => tx.insert(leads).values({ companyId: a.companyId, name: "Kunde A" }));
    await withTenant(b.companyId, (tx) => tx.insert(leads).values({ companyId: b.companyId, name: "Kunde B" }));

    const seenByA = await withTenant(a.companyId, (tx) => tx.select().from(leads));
    expect(seenByA.map((l) => l.name)).toEqual(["Kunde A"]);
    const companiesSeenByA = await withTenant(a.companyId, (tx) => tx.select().from(companies));
    expect(companiesSeenByA.map((c) => c.id)).toEqual([a.companyId]);
  });

  it("refuses to write rows into another company", async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const err = await withTenant(a.companyId, (tx) =>
      tx.insert(leads).values({ companyId: b.companyId, name: "Snik" }),
    ).catch((e: Error & { cause?: Error }) => e);
    expect((err as Error & { cause?: Error }).cause?.message).toMatch(/row-level security/);
  });

  it("cannot update or delete another company's rows", async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const [lead] = await withTenant(b.companyId, (tx) =>
      tx.insert(leads).values({ companyId: b.companyId, name: "B sin" }).returning(),
    );
    const updated = await withTenant(a.companyId, (tx) =>
      tx.update(leads).set({ name: "hacket" }).where(eq(leads.id, lead.id)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(a.companyId, (tx) => tx.delete(leads).where(eq(leads.id, lead.id)).returning());
    expect(deleted).toHaveLength(0);
  });

  it("is fail-closed: no tenant context means no rows", async () => {
    await makeCompany();
    const rows = await getDb().select().from(leads);
    expect(rows).toHaveLength(0);
    const cos = await getDb().select().from(companies);
    expect(cos).toHaveLength(0);
  });

  it("the database user is not a superuser and cannot bypass RLS", async () => {
    const [r] = await getDb().execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(r.rolsuper).toBe(false);
    expect(r.rolbypassrls).toBe(false);
  });

  it("audit log is append-only", async () => {
    const a = await makeCompany();
    const logs = await withTenant(a.companyId, (tx) => tx.select().from(auditLogs));
    expect(logs.some((l) => l.action === "company.created")).toBe(true);
    // As a tenant, UPDATE/DELETE silently match nothing (no RLS policy allows them).
    const upd = await withTenant(a.companyId, (tx) =>
      tx.update(auditLogs).set({ action: "x" }).where(eq(auditLogs.companyId, a.companyId)).returning(),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(a.companyId, (tx) =>
      tx.delete(auditLogs).where(eq(auditLogs.companyId, a.companyId)).returning(),
    );
    expect(del).toHaveLength(0);
    // Even the trusted system context cannot rewrite history (no UPDATE policy exists;
    // a trigger raises "append-only" as a second line of defence).
    const sysUpd = await withSystem((tx) =>
      tx.update(auditLogs).set({ action: "x" }).where(eq(auditLogs.companyId, a.companyId)).returning(),
    );
    expect(sysUpd).toHaveLength(0);
    const after = await withTenant(a.companyId, (tx) => tx.select().from(auditLogs));
    expect(after.every((l) => l.action !== "x")).toBe(true);
  });

  it("signup creates owner, default job types and DPA acceptance", async () => {
    const a = await makeCompany({ trade: "electrician" });
    const data = await withSystem(async (tx) => {
      const jt = await tx.execute<{ n: number }>(sql`select count(*)::int n from job_types where company_id = ${a.companyId}`);
      const dpa = await tx.execute<{ n: number }>(sql`select count(*)::int n from dpa_acceptances where company_id = ${a.companyId}`);
      return { jobTypes: jt[0].n, dpa: dpa[0].n };
    });
    expect(data.jobTypes).toBeGreaterThan(3);
    expect(data.dpa).toBe(1);
  });
});

describe("login", () => {
  it("accepts the right password and rate-limits brute force", async () => {
    const a = await makeCompany();
    const ok = await authenticate(a.email, a.password, "10.0.0.1");
    expect(ok.ok).toBe(true);
    for (let i = 0; i < MAX_FAILS_PER_EMAIL; i++) {
      const r = await authenticate(a.email, "feil-passord", "10.0.0.2");
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
    const blocked = await authenticate(a.email, a.password, "10.0.0.3");
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });
  it("gives the same answer for unknown e-mails", async () => {
    expect(await authenticate("finnes-ikke@example.no", "whatever-123", "10.0.0.9")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("rate limits", () => {
  it("caps repeated attempts per key within the window", async () => {
    const { overLimit } = await import("@/lib/auth/login");
    const key = `test:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await overLimit(key, 3, 60_000));
    expect(results).toEqual([false, false, false, true]);
  });
});

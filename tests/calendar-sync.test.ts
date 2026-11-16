import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withTenant } from "@/lib/db/client";
import { appointmentSync, busyBlocks, calendarConnections } from "@/lib/db/schema";
import { setCalendarFetchForTests } from "@/lib/calendar/providers";
import { pushAppointment, refreshBusyForConnection, saveConnection } from "@/lib/calendar/sync";
import { createAppointment, moveAppointment, setAppointmentStatus } from "@/lib/appointments";
import { decrypt } from "@/lib/crypto";
import { resetEnvCache } from "@/lib/env";
import { makeCompany } from "./helpers";

afterAll(closeDb);

/** A tiny in-memory Google Calendar + Microsoft Graph. */
function fakeCalendarApis() {
  const google = new Map<string, Record<string, unknown>>();
  const ms = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  let tokenN = 0;
  let unauthorized = false;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    log.push(`${method} ${url.hostname}${url.pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (unauthorized) return new Response("invalid_grant", { status: 401 });
    if (url.hostname === "oauth2.googleapis.com" || url.hostname === "login.microsoftonline.com") {
      return json({ access_token: `fresh-token-${++tokenN}`, expires_in: 3600 });
    }
    if (url.hostname === "www.googleapis.com") {
      const m = url.pathname.match(/\/events(?:\/(.+))?$/);
      const id = m?.[1];
      if (method === "GET") {
        return json({
          items: [
            { id: "ext1", start: { dateTime: "2030-01-07T09:00:00+01:00" }, end: { dateTime: "2030-01-07T11:00:00+01:00" } },
            { id: "free1", transparency: "transparent", start: { dateTime: "2030-01-07T12:00:00+01:00" }, end: { dateTime: "2030-01-07T13:00:00+01:00" } },
            { id: "gone", status: "cancelled", start: { dateTime: "2030-01-08T09:00:00+01:00" }, end: { dateTime: "2030-01-08T10:00:00+01:00" } },
            ...[...google.entries()].map(([gid, e]) => ({ id: gid, ...e })),
          ],
        });
      }
      if (method === "POST") {
        const gid = `g${google.size + 1}`;
        google.set(gid, JSON.parse(String(init!.body)));
        return json({ id: gid });
      }
      if (method === "PATCH") {
        google.set(id!, JSON.parse(String(init!.body)));
        return json({ id });
      }
      if (method === "DELETE") {
        google.delete(id!);
        return new Response(null, { status: 204 });
      }
    }
    if (url.hostname === "graph.microsoft.com") {
      if (url.pathname.endsWith("/calendarView")) {
        return json({
          value: [
            { id: "m1", showAs: "busy", start: { dateTime: "2030-01-09T08:00:00.0000000" }, end: { dateTime: "2030-01-09T09:00:00.0000000" } },
            { id: "m2", showAs: "free", start: { dateTime: "2030-01-09T10:00:00.0000000" }, end: { dateTime: "2030-01-09T11:00:00.0000000" } },
            { id: "m3", showAs: "oof", start: { dateTime: "2030-01-10T00:00:00.0000000" }, end: { dateTime: "2030-01-11T00:00:00.0000000" } },
          ],
        });
      }
      if (method === "POST") {
        ms.set(`m${ms.size + 10}`, JSON.parse(String(init!.body)));
        return json({ id: `m${ms.size + 9}` });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { google, ms, log, fetcher, setUnauthorized: (v: boolean) => (unauthorized = v) };
}

let apis: ReturnType<typeof fakeCalendarApis>;
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  process.env.MICROSOFT_CLIENT_ID = "mid";
  process.env.MICROSOFT_CLIENT_SECRET = "msecret";
  resetEnvCache();
  apis = fakeCalendarApis();
  setCalendarFetchForTests(apis.fetcher);
});
afterEach(() => setCalendarFetchForTests(null));

const connect = (c: { companyId: string; userId: string }, provider: "google" | "microsoft", expiresAt = new Date(Date.now() + 3600_000)) =>
  saveConnection({ companyId: c.companyId, userId: c.userId, provider, email: "kari@example.no", accessToken: "tok", refreshToken: "refresh", expiresAt });

describe("calendar sync", () => {
  it("imports Google busy time but ignores free, cancelled and our own events", async () => {
    const c = await makeCompany();
    const conn = await connect(c, "google");
    const blocks = await withTenant(c.companyId, (tx) => tx.select().from(busyBlocks).where(eq(busyBlocks.connectionId, conn.id)));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startsAt.toISOString()).toBe("2030-01-07T08:00:00.000Z");
    expect(decrypt(conn.accessTokenEnc!)).toBe("tok"); // stored encrypted
    expect(conn.accessTokenEnc).not.toContain("tok");
  });

  it("imports Outlook busy and out-of-office time", async () => {
    const c = await makeCompany();
    const conn = await connect(c, "microsoft");
    const blocks = await withTenant(c.companyId, (tx) => tx.select().from(busyBlocks).where(eq(busyBlocks.connectionId, conn.id)));
    expect(blocks.map((b) => b.startsAt.toISOString()).sort()).toEqual(["2030-01-09T08:00:00.000Z", "2030-01-10T00:00:00.000Z"]);
  });

  it("creates, moves and removes the calendar event for a befaring", async () => {
    const c = await makeCompany();
    await connect(c, "google");
    const appt = await createAppointment({
      companyId: c.companyId,
      actor: { userId: c.userId, kind: "user" },
      assignedUserId: c.userId,
      title: "Befaring: Bad",
      startsAt: new Date("2030-02-04T09:00:00Z"),
      endsAt: new Date("2030-02-04T09:45:00Z"),
      address: "Kirkegata 15, 0153 Oslo",
      customerName: "Ola Nordmann",
      customerPhone: "+4740000001",
    });
    await pushAppointment(c.companyId, appt.id); // waits for the queued push too
    expect(apis.google.size).toBe(1);
    const [ev] = [...apis.google.values()] as { summary: string; location: string; description: string; extendedProperties: { private: { vaktaAppointmentId: string } } }[];
    expect(ev.summary).toBe("Befaring: Bad – Ola Nordmann");
    expect(ev.location).toBe("Kirkegata 15, 0153 Oslo");
    expect(ev.description).toContain("400 00 001");
    expect(ev.extendedProperties.private.vaktaAppointmentId).toBe(appt.id);

    // Our own event must not come back as "busy".
    const [conn] = await withTenant(c.companyId, (tx) => tx.select().from(calendarConnections));
    await refreshBusyForConnection(conn);
    const blocks = await withTenant(c.companyId, (tx) => tx.select().from(busyBlocks));
    expect(blocks).toHaveLength(1);

    await moveAppointment({ companyId: c.companyId, id: appt.id, startsAt: new Date("2030-02-04T11:00:00Z"), endsAt: new Date("2030-02-04T11:45:00Z"), actor: { userId: c.userId, kind: "user" } });
    await pushAppointment(c.companyId, appt.id);
    expect(apis.log.some((l) => l.startsWith("PATCH"))).toBe(true);
    expect(apis.google.size).toBe(1);

    await setAppointmentStatus(c.companyId, appt.id, "cancelled", { userId: c.userId, kind: "user" });
    await pushAppointment(c.companyId, appt.id);
    expect(apis.google.size).toBe(0);
    const syncs = await withTenant(c.companyId, (tx) => tx.select().from(appointmentSync));
    expect(syncs).toHaveLength(0);
  });

  it("refreshes an expired access token and keeps it encrypted", async () => {
    const c = await makeCompany();
    const conn = await connect(c, "google", new Date(Date.now() - 1000));
    expect(apis.log[0]).toBe("POST oauth2.googleapis.com/token");
    const [after] = await withTenant(c.companyId, (tx) => tx.select().from(calendarConnections).where(eq(calendarConnections.id, conn.id)));
    expect(decrypt(after.accessTokenEnc!)).toBe("fresh-token-1");
    expect(after.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("marks a connection as revoked when access is withdrawn", async () => {
    const c = await makeCompany();
    const conn = await connect(c, "google");
    apis.setUnauthorized(true);
    expect(await refreshBusyForConnection({ ...conn, tokenExpiresAt: new Date(0) })).toBe(-1);
    const [after] = await withTenant(c.companyId, (tx) => tx.select().from(calendarConnections).where(eq(calendarConnections.id, conn.id)));
    expect(after.status).toBe("revoked");
    expect(after.lastError).toBeTruthy();
  });
});

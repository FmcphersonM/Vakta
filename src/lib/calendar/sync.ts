import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { withSystem, withTenant } from "../db/client";
import { appointments, appointmentSync, busyBlocks, calendarConnections, companies, type CalendarConnection } from "../db/schema";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";
import { fmt } from "../format";
import { CalendarAuthError, providers, type EventInput } from "./providers";

const SYNC_DAYS = 60;

/** A valid access token for a connection, refreshing (and saving) it if needed. */
async function accessToken(conn: CalendarConnection): Promise<string> {
  if (conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) throw new CalendarAuthError("no refresh token");
  const t = await providers[conn.provider].refresh(decrypt(conn.refreshTokenEnc));
  await withTenant(conn.companyId, (tx) =>
    tx
      .update(calendarConnections)
      .set({
        accessTokenEnc: encrypt(t.accessToken),
        tokenExpiresAt: t.expiresAt,
        ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken) } : {}),
      })
      .where(eq(calendarConnections.id, conn.id)),
  );
  return t.accessToken;
}

async function markError(conn: CalendarConnection, e: unknown) {
  const auth = e instanceof CalendarAuthError;
  await withTenant(conn.companyId, (tx) =>
    tx
      .update(calendarConnections)
      .set({ status: auth ? "revoked" : "error", lastError: String(e instanceof Error ? e.message : e).slice(0, 300) })
      .where(eq(calendarConnections.id, conn.id)),
  );
}

/** Replace the cached busy time for one connected calendar. */
export async function refreshBusyForConnection(conn: CalendarConnection) {
  try {
    const token = await accessToken(conn);
    const from = new Date();
    const to = new Date(Date.now() + SYNC_DAYS * 86400_000);
    const own = await withTenant(conn.companyId, (tx) =>
      tx.select({ id: appointmentSync.externalEventId }).from(appointmentSync).where(eq(appointmentSync.connectionId, conn.id)),
    );
    const busy = await providers[conn.provider].busy(token, conn.calendarId, from, to, new Set(own.map((o) => o.id)));
    await withTenant(conn.companyId, async (tx) => {
      await tx.delete(busyBlocks).where(eq(busyBlocks.connectionId, conn.id));
      if (busy.length) {
        await tx.insert(busyBlocks).values(
          busy.slice(0, 2000).map((b) => ({ companyId: conn.companyId, userId: conn.userId, connectionId: conn.id, startsAt: b.start, endsAt: b.end })),
        );
      }
      await tx.update(calendarConnections).set({ lastSyncedAt: new Date(), status: "active", lastError: null }).where(eq(calendarConnections.id, conn.id));
    });
    return busy.length;
  } catch (e) {
    console.error(`[calendar] refresh ${conn.provider} failed`, e instanceof Error ? e.message : e);
    await markError(conn, e);
    return -1;
  }
}

/** Refresh a company's calendars unless they were refreshed in the last 2 minutes. */
export async function refreshBusyForCompany(companyId: string, maxAgeMs = 120_000) {
  const conns = await withTenant(companyId, (tx) =>
    tx
      .select()
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.status, "active"),
          or(isNull(calendarConnections.lastSyncedAt), lt(calendarConnections.lastSyncedAt, new Date(Date.now() - maxAgeMs))),
        ),
      ),
  );
  await Promise.all(conns.map((c) => refreshBusyForConnection(c)));
}

/** Background job: refresh every active calendar connection. */
export async function refreshAllCalendars() {
  const conns = await withSystem((tx) => tx.select().from(calendarConnections).where(eq(calendarConnections.status, "active")));
  let ok = 0;
  for (const c of conns) if ((await refreshBusyForConnection(c)) >= 0) ok++;
  return { connections: conns.length, ok };
}

/**
 * Mirror one befaring into the assigned person's connected calendar(s):
 * create, update after a move, delete after cancellation or reassignment.
 */
const pushChains = new Map<string, Promise<void>>();

export function pushAppointment(companyId: string, appointmentId: string): Promise<void> {
  // One push at a time per befaring, so two quick moves never create duplicate events.
  const prev = pushChains.get(appointmentId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => doPush(companyId, appointmentId));
  pushChains.set(appointmentId, next);
  void next.finally(() => {
    if (pushChains.get(appointmentId) === next) pushChains.delete(appointmentId);
  }).catch(() => undefined);
  return next;
}

async function doPush(companyId: string, appointmentId: string) {
  const data = await withTenant(companyId, async (tx) => {
    const [appt] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
    if (!appt) return null;
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    const syncs = await tx.select().from(appointmentSync).where(eq(appointmentSync.appointmentId, appointmentId));
    const conns = await tx.select().from(calendarConnections).where(eq(calendarConnections.status, "active"));
    return { appt, company, syncs, conns };
  });
  if (!data) return;
  const { appt, company, syncs, conns } = data;
  const mine = conns.filter((c) => c.userId === appt.assignedUserId);
  const ev: EventInput = {
    title: appt.customerName ? `${appt.title} – ${appt.customerName}` : appt.title,
    start: appt.startsAt,
    end: appt.endsAt,
    location: appt.address,
    description: [
      appt.customerName && `Kunde: ${appt.customerName}`,
      appt.customerPhone && `Telefon: ${fmt.phone(appt.customerPhone)}`,
      appt.notes,
      appt.leadId && `${env().APP_URL}/leads/${appt.leadId}`,
      `Lagt inn av ${env().NEXT_PUBLIC_APP_NAME}`,
    ]
      .filter(Boolean)
      .join("\n"),
    appointmentId: appt.id,
    tz: company.timezone,
  };

  // Remove events from calendars that no longer should have them.
  const keep = appt.status === "scheduled" || appt.status === "completed" || appt.status === "no_show";
  for (const s of syncs) {
    const conn = conns.find((c) => c.id === s.connectionId);
    if (keep && conn && conn.userId === appt.assignedUserId) continue;
    try {
      if (conn) await providers[conn.provider].deleteEvent(await accessToken(conn), conn.calendarId, s.externalEventId);
    } catch (e) {
      if (conn) await markError(conn, e);
    }
    await withTenant(companyId, (tx) =>
      tx.delete(appointmentSync).where(and(eq(appointmentSync.appointmentId, appt.id), eq(appointmentSync.connectionId, s.connectionId))),
    );
  }
  if (appt.status !== "scheduled") return;

  for (const conn of mine) {
    const existing = syncs.find((s) => s.connectionId === conn.id);
    try {
      const token = await accessToken(conn);
      if (existing) {
        await providers[conn.provider].updateEvent(token, conn.calendarId, existing.externalEventId, ev);
        await withTenant(companyId, (tx) =>
          tx.update(appointmentSync).set({ syncedAt: new Date() }).where(and(eq(appointmentSync.appointmentId, appt.id), eq(appointmentSync.connectionId, conn.id))),
        );
      } else {
        const id = await providers[conn.provider].createEvent(token, conn.calendarId, ev);
        await withTenant(companyId, (tx) => tx.insert(appointmentSync).values({ appointmentId: appt.id, connectionId: conn.id, companyId, externalEventId: id }));
      }
    } catch (e) {
      console.error("[calendar] push failed", e instanceof Error ? e.message : e);
      await markError(conn, e);
    }
  }
}

/** Remove synced events (used by GDPR erasure before the befaringer are deleted). */
export async function deleteCalendarEventsFor(companyId: string, appointmentIds: string[]) {
  if (!appointmentIds.length) return;
  const { syncs, conns } = await withTenant(companyId, async (tx) => ({
    syncs: await tx.select().from(appointmentSync).where(inArray(appointmentSync.appointmentId, appointmentIds)),
    conns: await tx.select().from(calendarConnections),
  }));
  for (const s of syncs) {
    const conn = conns.find((c) => c.id === s.connectionId);
    if (!conn) continue;
    try {
      await providers[conn.provider].deleteEvent(await accessToken(conn), conn.calendarId, s.externalEventId);
    } catch (e) {
      console.error("[calendar] delete failed", e instanceof Error ? e.message : e);
    }
  }
}

export async function disconnectCalendar(companyId: string, connectionId: string) {
  const [conn] = await withTenant(companyId, (tx) => tx.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)));
  if (!conn) return;
  if (conn.provider === "google" && conn.refreshTokenEnc) await providers.google.revoke(decrypt(conn.refreshTokenEnc));
  await withTenant(companyId, (tx) => tx.delete(calendarConnections).where(eq(calendarConnections.id, connectionId)));
}

/** Save tokens after the OAuth callback (one connection per person per provider). */
export async function saveConnection(input: {
  companyId: string;
  userId: string;
  provider: "google" | "microsoft";
  email: string | null;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}) {
  const [row] = await withTenant(input.companyId, (tx) =>
    tx
      .insert(calendarConnections)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        provider: input.provider,
        accountEmail: input.email,
        accessTokenEnc: encrypt(input.accessToken),
        refreshTokenEnc: input.refreshToken ? encrypt(input.refreshToken) : null,
        tokenExpiresAt: input.expiresAt,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [calendarConnections.companyId, calendarConnections.userId, calendarConnections.provider],
        set: {
          accountEmail: input.email,
          accessTokenEnc: encrypt(input.accessToken),
          ...(input.refreshToken ? { refreshTokenEnc: encrypt(input.refreshToken) } : {}),
          tokenExpiresAt: input.expiresAt,
          status: "active",
          lastError: null,
        },
      })
      .returning(),
  );
  await refreshBusyForConnection(row);
  return row;
}

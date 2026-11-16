/**
 * Google Calendar and Microsoft 365 (Outlook) over plain REST — no SDKs, so
 * the surface is small and easy to test with a fake fetch.
 */
import { env } from "../env";

export type Provider = "google" | "microsoft";
export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: Date; email?: string | null };
export type BusyInterval = { start: Date; end: Date };
export type EventInput = { title: string; start: Date; end: Date; location?: string | null; description?: string | null; appointmentId: string; tz: string };

export class CalendarAuthError extends Error {}

let fetcher: typeof fetch = (...a) => fetch(...a);
export function setCalendarFetchForTests(f: typeof fetch | null) {
  fetcher = f ?? ((...a) => fetch(...a));
}

async function call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetcher(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(10_000) });
  if (res.status === 401 || res.status === 403) throw new CalendarAuthError(`${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Calendar API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  if (res.status === 204 || res.status === 404 || res.status === 410) return undefined as T;
  return (await res.json()) as T;
}

function form(data: Record<string, string>) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() };
}

function jwtEmail(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return payload.email ?? payload.preferred_username ?? null;
  } catch {
    return null;
  }
}

const redirectUri = (p: Provider) => `${env().APP_URL}/api/integrations/${p}/callback`;

// ── Google ───────────────────────────────────────────────────────────────────
const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

export const google = {
  authUrl(state: string) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri("google"),
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return u.toString();
  },
  async exchange(code: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ code, client_id: env().GOOGLE_CLIENT_ID!, client_secret: env().GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri("google"), grant_type: "authorization_code" }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + r.expires_in * 1000), email: jwtEmail(r.id_token) };
  },
  async refresh(refreshToken: string): Promise<Tokens> {
    const r = await call<{ access_token: string; expires_in: number; refresh_token?: string }>(
      "https://oauth2.googleapis.com/token",
      form({ refresh_token: refreshToken, client_id: env().GOOGLE_CLIENT_ID!, client_secret: env().GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
    ).catch((e) => {
      throw new CalendarAuthError(String(e));
    });
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },
  async busy(token: string, calendarId: string, from: Date, to: Date, ownEventIds: Set<string>): Promise<BusyInterval[]> {
    type GEvent = { id: string; status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } };
    const out: BusyInterval[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      u.search = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", ...(pageToken ? { pageToken } : {}) }).toString();
      const r = await call<{ items?: GEvent[]; nextPageToken?: string }>(u.toString(), { token });
      for (const e of r.items ?? []) {
        if (e.status === "cancelled" || e.transparency === "transparent") continue;
        if (ownEventIds.has(e.id) || e.extendedProperties?.private?.vaktaAppointmentId) continue;
        const s = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00` : null);
        const en = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00` : null);
        if (s && en) out.push({ start: new Date(s), end: new Date(en) });
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  },
  async createEvent(token: string, calendarId: string, ev: EventInput): Promise<string> {
    const r = await call<{ id: string }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      token,
      body: JSON.stringify(googleBody(ev)),
    });
    return r.id;
  },
  async updateEvent(token: string, calendarId: string, id: string, ev: EventInput) {
    await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(googleBody(ev)),
    });
  },
  async deleteEvent(token: string, calendarId: string, id: string) {
    await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  async revoke(token: string) {
    await call(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
  },
};

function googleBody(ev: EventInput) {
  return {
    summary: ev.title,
    location: ev.location ?? undefined,
    description: ev.description ?? undefined,
    start: { dateTime: ev.start.toISOString(), timeZone: ev.tz },
    end: { dateTime: ev.end.toISOString(), timeZone: ev.tz },
    extendedProperties: { private: { vaktaAppointmentId: ev.appointmentId } },
  };
}

// ── Microsoft 365 / Outlook ─────────────────────────────────────────────────
const MS_SCOPES = ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];
const MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";

export const microsoft = {
  authUrl(state: string) {
    const u = new URL(`${MS_AUTH}/authorize`);
    u.search = new URLSearchParams({
      client_id: env().MICROSOFT_CLIENT_ID!,
      response_type: "code",
      redirect_uri: redirectUri("microsoft"),
      response_mode: "query",
      scope: MS_SCOPES.join(" "),
      prompt: "select_account",
      state,
    }).toString();
    return u.toString();
  },
  async exchange(code: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>(
      `${MS_AUTH}/token`,
      form({ client_id: env().MICROSOFT_CLIENT_ID!, client_secret: env().MICROSOFT_CLIENT_SECRET!, code, redirect_uri: redirectUri("microsoft"), grant_type: "authorization_code", scope: MS_SCOPES.join(" ") }),
    );
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + r.expires_in * 1000), email: jwtEmail(r.id_token) };
  },
  async refresh(refreshToken: string): Promise<Tokens> {
    const r = await call<{ access_token: string; refresh_token?: string; expires_in: number }>(
      `${MS_AUTH}/token`,
      form({ client_id: env().MICROSOFT_CLIENT_ID!, client_secret: env().MICROSOFT_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token", scope: MS_SCOPES.join(" ") }),
    ).catch((e) => {
      throw new CalendarAuthError(String(e));
    });
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },
  async busy(token: string, _calendarId: string, from: Date, to: Date, ownEventIds: Set<string>): Promise<BusyInterval[]> {
    type MEvent = { id: string; showAs?: string; isCancelled?: boolean; start: { dateTime: string }; end: { dateTime: string } };
    const out: BusyInterval[] = [];
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: "id,start,end,showAs,isCancelled", $top: "200" })}`;
    while (url) {
      const r: { value?: MEvent[]; "@odata.nextLink"?: string } = await call(url, { token, headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const e of r.value ?? []) {
        if (e.isCancelled || e.showAs === "free" || e.showAs === "workingElsewhere" || ownEventIds.has(e.id)) continue;
        out.push({ start: new Date(`${e.start.dateTime.replace(/Z?$/, "")}Z`), end: new Date(`${e.end.dateTime.replace(/Z?$/, "")}Z`) });
      }
      url = r["@odata.nextLink"];
    }
    return out;
  },
  async createEvent(token: string, _calendarId: string, ev: EventInput): Promise<string> {
    const r = await call<{ id: string }>("https://graph.microsoft.com/v1.0/me/events", { method: "POST", token, body: JSON.stringify(msBody(ev)) });
    return r.id;
  },
  async updateEvent(token: string, _calendarId: string, id: string, ev: EventInput) {
    await call(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`, { method: "PATCH", token, body: JSON.stringify(msBody(ev)) });
  },
  async deleteEvent(token: string, _calendarId: string, id: string) {
    await call(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  async revoke() {},
};

function msBody(ev: EventInput) {
  const utc = (d: Date) => d.toISOString().replace("Z", "");
  return {
    subject: ev.title,
    body: { contentType: "text", content: ev.description ?? "" },
    start: { dateTime: utc(ev.start), timeZone: "UTC" },
    end: { dateTime: utc(ev.end), timeZone: "UTC" },
    location: ev.location ? { displayName: ev.location } : undefined,
    showAs: "busy",
  };
}

export const providers = { google, microsoft };

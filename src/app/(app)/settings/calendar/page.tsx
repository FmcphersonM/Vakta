import { eq } from "drizzle-orm";
import { CalendarCheck2, RefreshCw, Unplug, AlertTriangle } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { calendarConnections, users } from "@/lib/db/schema";
import { features } from "@/lib/env";
import { Badge, Card, buttonClass } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { fmt } from "@/lib/format";
import { disconnectCalendarAction, syncCalendarNow } from "@/app/(app)/_actions/calendar";

const NAMES = { google: "Google Kalender", microsoft: "Outlook / Microsoft 365" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { t, company, locale, user } = await requireCompany();
  const sp = await searchParams;
  const c = t.settings.calendar;
  const conns = await withTenant(company.id, (tx) =>
    tx.select({ conn: calendarConnections, name: users.name }).from(calendarConnections).innerJoin(users, eq(users.id, calendarConnections.userId)),
  );
  const mine = conns.filter((x) => x.conn.userId === user.id);
  const others = conns.filter((x) => x.conn.userId !== user.id);
  const available = { google: features.google(), microsoft: features.microsoft() };

  return (
    <SettingsPage title={t.settings.sections.calendar} back={t.settings.title} intro={c.intro}>
      {sp.connected && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {c.connected}: {NAMES[sp.connected as "google"] ?? sp.connected}</p>}
      {sp.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t.common.error}</p>}
      <Card className="divide-y divide-slate-100">
        {(["google", "microsoft"] as const).map((p) => {
          const row = mine.find((m) => m.conn.provider === p)?.conn;
          return (
            <div key={p} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
              <CalendarCheck2 className="h-6 w-6 text-brand-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{NAMES[p]}</p>
                {row ? (
                  <p className="text-sm text-slate-500">
                    {row.accountEmail ?? ""} {row.lastSyncedAt ? `· ${c.lastSync(fmt.relative(row.lastSyncedAt, locale))}` : ""}
                  </p>
                ) : !available[p] ? (
                  <p className="text-sm text-slate-500">{c.notAvailable}</p>
                ) : null}
                {row && row.status !== "active" && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {c.error}: {row.lastError}
                  </p>
                )}
              </div>
              {row ? (
                <div className="flex gap-2">
                  <form action={syncCalendarNow}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className={buttonClass("secondary", "sm")}>
                      <RefreshCw className="h-4 w-4" aria-hidden /> {c.syncNow}
                    </button>
                  </form>
                  <form action={disconnectCalendarAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className={buttonClass("ghost", "sm")}>
                      <Unplug className="h-4 w-4" aria-hidden /> {c.disconnect}
                    </button>
                  </form>
                </div>
              ) : (
                <a
                  href={available[p] ? `/api/integrations/${p}/connect` : undefined}
                  aria-disabled={!available[p]}
                  className={buttonClass("primary", "sm", !available[p] ? "pointer-events-none opacity-50" : "")}
                >
                  {p === "google" ? c.connectGoogle : c.connectMicrosoft}
                </a>
              )}
            </div>
          );
        })}
      </Card>
      {others.length > 0 && (
        <Card className="p-4 sm:px-5">
          <h2 className="mb-2 font-semibold text-slate-900">{t.settings.sections.team}</h2>
          <ul className="space-y-1.5 text-sm">
            {others.map(({ conn, name }) => (
              <li key={conn.id} className="flex items-center gap-2">
                <span className="text-slate-800">{name}</span>
                <span className="text-slate-500">· {NAMES[conn.provider]}</span>
                <Badge tone={conn.status === "active" ? "green" : "red"}>{conn.status === "active" ? c.connected : c.error}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </SettingsPage>
  );
}

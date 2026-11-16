import { desc, eq } from "drizzle-orm";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";
import { Card, EmptyState } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { fmt } from "@/lib/format";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  const rows = await withTenant(company.id, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, actor: auditLogs.actor, createdAt: auditLogs.createdAt, entityType: auditLogs.entityType, name: users.name, metadata: auditLogs.metadata })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(300),
  );
  return (
    <SettingsPage title={t.settings.sections.audit} back={t.settings.title} intro={t.settings.sectionHints.audit}>
      <Card>
        {rows.length === 0 ? (
          <EmptyState>{t.settings.audit.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 sm:px-5">
                <span className="w-40 shrink-0 tabular-nums text-slate-500">{fmt.dateTime(r.createdAt, locale, company.timezone)}</span>
                <span className="font-mono text-[13px] text-slate-900">{r.action}</span>
                <span className="ml-auto text-slate-500">{r.name ?? t.settings.audit.actors[r.actor]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </SettingsPage>
  );
}

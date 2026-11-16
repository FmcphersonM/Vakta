import Link from "next/link";
import { desc } from "drizzle-orm";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { dpaAcceptances, privacyRequests } from "@/lib/db/schema";
import { Card } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { DeleteCompanyForm, PhoneRequestForm } from "@/components/settings/privacy";
import { fmt } from "@/lib/format";

export default async function Page() {
  const { t, company, locale, membership } = await requireCompany();
  const p = t.settings.privacy;
  const { dpa, reqs } = await withTenant(company.id, async (tx) => ({
    dpa: (await tx.select().from(dpaAcceptances).orderBy(desc(dpaAcceptances.acceptedAt)).limit(1))[0],
    reqs: await tx.select().from(privacyRequests).orderBy(desc(privacyRequests.createdAt)).limit(20),
  }));
  return (
    <SettingsPage title={t.settings.sections.privacy} back={t.settings.title} intro={p.intro}>
      <Card className="p-4 sm:p-6">
        <PhoneRequestForm locale={locale} />
      </Card>
      {reqs.length > 0 && (
        <Card className="p-4 sm:p-6">
          <h2 className="mb-2 font-semibold text-slate-900">{p.requests}</h2>
          <ul className="space-y-1 text-sm text-slate-600">
            {reqs.map((r) => (
              <li key={r.id}>
                {fmt.dateTime(r.createdAt, locale, company.timezone)} · {r.kind} · {Object.entries(r.result ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ")}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="space-y-2 p-4 text-sm sm:p-6">
        <h2 className="font-semibold text-slate-900">{p.dpa}</h2>
        {dpa && <p className="text-slate-600">{p.dpaAccepted(dpa.version, fmt.date(dpa.acceptedAt, locale))}</p>}
        <p className="text-slate-600">{p.dataLocation}</p>
        <p className="flex flex-wrap gap-4">
          <Link href="/legal/dpa" className="font-medium text-brand-700 underline">{p.dpaRead}</Link>
          <Link href={`/personvern/${company.slug}`} className="font-medium text-brand-700 underline">{t.privacyPage.title(company.name)}</Link>
        </p>
      </Card>
      {membership.role === "owner" && (
        <Card className="p-4 ring-red-200 sm:p-6">
          <h2 className="font-semibold text-red-800">{p.deleteCompany}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">{p.deleteCompanyHint}</p>
          {company.deletionRequestedAt ? <p className="text-sm text-red-800">{p.deleteScheduled}</p> : <DeleteCompanyForm locale={locale} />}
        </Card>
      )}
    </SettingsPage>
  );
}

import { asc } from "drizzle-orm";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { jobTypes } from "@/lib/db/schema";
import { SettingsPage } from "@/components/settings/shell";
import { ServicesList } from "@/components/settings/forms";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  const rows = await withTenant(company.id, (tx) => tx.select().from(jobTypes).orderBy(asc(jobTypes.sort), asc(jobTypes.createdAt)));
  return (
    <SettingsPage title={t.settings.sections.services} back={t.settings.title} intro={t.settings.sectionHints.services}>
      <ServicesList jobTypes={rows} locale={locale} />
    </SettingsPage>
  );
}

import { requireCompany } from "@/lib/auth/current";
import { SettingsPage } from "@/components/settings/shell";
import { BusinessForm } from "@/components/settings/forms";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  return (
    <SettingsPage title={t.settings.sections.business} back={t.settings.title} intro={t.settings.sectionHints.business}>
      <BusinessForm c={company} locale={locale} />
    </SettingsPage>
  );
}

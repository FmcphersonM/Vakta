import { requireCompany } from "@/lib/auth/current";
import { SettingsPage } from "@/components/settings/shell";
import { HoursForm } from "@/components/settings/forms";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  return (
    <SettingsPage title={t.settings.sections.hours} back={t.settings.title} intro={t.settings.sectionHints.hours}>
      <HoursForm c={company} locale={locale} />
    </SettingsPage>
  );
}

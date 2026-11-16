import { requireCompany } from "@/lib/auth/current";
import { SettingsPage } from "@/components/settings/shell";
import { AgentForm } from "@/components/settings/forms";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  return (
    <SettingsPage title={t.settings.sections.agent} back={t.settings.title} intro={t.settings.sectionHints.agent}>
      <AgentForm c={company} locale={locale} />
    </SettingsPage>
  );
}

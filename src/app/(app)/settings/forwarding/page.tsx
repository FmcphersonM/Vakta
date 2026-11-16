import { requireCompany } from "@/lib/auth/current";
import { SettingsPage } from "@/components/settings/shell";
import { ForwardingForm } from "@/components/settings/forms";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  return (
    <SettingsPage title={t.settings.sections.forwarding} back={t.settings.title} intro={t.settings.sectionHints.forwarding}>
      <ForwardingForm c={company} locale={locale} />
    </SettingsPage>
  );
}

import { requireCompany } from "@/lib/auth/current";
import { withSystem } from "@/lib/db/client";
import { companyNumber } from "@/lib/telephony/numbers";
import { Card } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { GetNumberButton, NumberCard } from "@/components/settings/phone";

export default async function Page() {
  const { t, company, locale } = await requireCompany();
  const number = await withSystem((tx) => companyNumber(tx, company.id));
  return (
    <SettingsPage title={t.settings.sections.phone} back={t.settings.title}>
      <Card className="p-4 sm:p-6">
        {number ? (
          <NumberCard e164={number.e164} locale={locale} simulated={number.provider === "mock"} />
        ) : (
          <div className="space-y-3">
            <p className="text-slate-600">{t.settings.phone.none}</p>
            <GetNumberButton locale={locale} />
          </div>
        )}
      </Card>
    </SettingsPage>
  );
}

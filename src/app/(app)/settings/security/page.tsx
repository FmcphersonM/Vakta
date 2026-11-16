import { requireCompany } from "@/lib/auth/current";
import { Card, Toggle } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { LogoutOthers, PasswordForm, TwoFactorSetup } from "@/components/settings/security";
import { saveRequire2fa } from "@/app/(app)/_actions/settings";
import { SubmitButton } from "@/components/ui/form";

export default async function Page({ searchParams }: { searchParams: Promise<{ enforce?: string }> }) {
  const { t, user, locale, company, membership } = await requireCompany("no2fa");
  const sp = await searchParams;
  const s = t.settings.security;
  return (
    <SettingsPage title={t.settings.sections.security} back={t.settings.title}>
      {sp.enforce && !user.totpEnabledAt && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{s.enforced}</p>
      )}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 font-semibold text-slate-900">
          {s.twofa}: <span className={user.totpEnabledAt ? "text-emerald-700" : "text-slate-500"}>{user.totpEnabledAt ? s.twofaOn : s.twofaOff}</span>
        </h2>
        <TwoFactorSetup locale={locale} enabled={!!user.totpEnabledAt} />
      </Card>
      {membership.role === "owner" && (
        <Card className="p-4 sm:p-6">
          <form action={saveRequire2fa} className="space-y-3">
            <Toggle name="require2fa" label={s.requireForTeam} defaultChecked={company.require2fa} />
            <SubmitButton size="sm" variant="secondary">{t.common.save}</SubmitButton>
          </form>
        </Card>
      )}
      <Card className="p-4 sm:p-6">
        <h2 className="mb-3 font-semibold text-slate-900">{s.changePassword}</h2>
        <PasswordForm locale={locale} />
      </Card>
      <Card className="p-4 sm:p-6">
        <LogoutOthers locale={locale} />
      </Card>
    </SettingsPage>
  );
}

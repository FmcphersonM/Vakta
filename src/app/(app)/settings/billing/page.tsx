import { Check, CreditCard } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { features } from "@/lib/env";
import { serviceState } from "@/lib/billing/status";
import { Badge, Card } from "@/components/ui";
import { SubmitButton } from "@/components/ui/form";
import { SettingsPage } from "@/components/settings/shell";
import { fmt } from "@/lib/format";
import { openBillingPortal, startSubscription } from "@/app/(app)/_actions/billing";

export default async function Page({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const { t, company, locale } = await requireCompany("no2fa");
  const sp = await searchParams;
  const b = t.settings.billing;
  const svc = serviceState(company);
  const hasSub = !!company.stripeSubscriptionId && company.subscriptionStatus !== "canceled";
  return (
    <SettingsPage title={t.settings.sections.billing} back={t.settings.title}>
      {sp.success && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✓ {b.thanks}</p>}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{b.plan}</h2>
            <p className="text-2xl font-semibold tracking-tight text-slate-900">{b.price}</p>
          </div>
          <Badge tone={svc.active ? "green" : "red"}>{b.statuses[company.subscriptionStatus as keyof typeof b.statuses] ?? company.subscriptionStatus}</Badge>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
          {b.features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-brand-600" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
          {company.subscriptionStatus === "trialing" && <p>{b.trialEnds(fmt.date(company.trialEndsAt, locale))}</p>}
          {company.currentPeriodEnd && company.subscriptionStatus === "active" && <p>{b.renews(fmt.date(company.currentPeriodEnd, locale))}</p>}
        </div>
        <div className="mt-4">
          {!features.stripe() ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{b.notConfigured}</p>
          ) : hasSub ? (
            <form action={openBillingPortal}>
              <SubmitButton variant="secondary">
                <CreditCard className="h-4 w-4" aria-hidden /> {b.manage}
              </SubmitButton>
            </form>
          ) : (
            <form action={startSubscription}>
              <SubmitButton size="lg">{b.subscribe}</SubmitButton>
            </form>
          )}
        </div>
      </Card>
    </SettingsPage>
  );
}

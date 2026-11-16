import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import clsx from "clsx";
import { Check } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { withSystem, withTenant } from "@/lib/db/client";
import { jobTypes } from "@/lib/db/schema";
import { companyNumber } from "@/lib/telephony/numbers";
import { Card } from "@/components/ui";
import { Logo } from "@/components/logo";
import { BusinessStep, HoursStep, PhoneStep, ServicesStep, TestStep } from "@/components/onboarding/steps";
import { goToStep } from "./actions";

export const metadata = { title: "Kom i gang" };

const STEPS = ["business", "services", "hours", "phone", "test"] as const;
const MINUTES_LEFT = { business: 8, services: 6, hours: 4, phone: 3, test: 1 } as const;

export default async function OnboardingPage() {
  const { t, company, locale, user } = await requireCompany("onboarding");
  if (company.onboardingStep === "done") redirect("/today");
  const step = company.onboardingStep as (typeof STEPS)[number];
  const idx = STEPS.indexOf(step);
  const titles = { business: t.onboarding.businessTitle, services: t.onboarding.servicesTitle, hours: t.onboarding.hoursTitle, phone: t.onboarding.phoneTitle, test: t.onboarding.testTitle };
  const intros = { business: t.onboarding.businessIntro, services: t.onboarding.servicesIntro, hours: t.onboarding.hoursIntro, phone: t.onboarding.phoneIntro, test: t.onboarding.testIntro };

  let body: React.ReactNode = null;
  if (step === "business") body = <BusinessStep locale={locale} c={company} />;
  if (step === "services") {
    const jt = await withTenant(company.id, (tx) => tx.select().from(jobTypes).orderBy(asc(jobTypes.sort)));
    body = <ServicesStep locale={locale} jobTypes={jt} befaringMinutes={company.befaringMinutes} />;
  }
  if (step === "hours") body = <HoursStep locale={locale} hours={company.businessHours} />;
  if (step === "phone") body = <PhoneStep locale={locale} mobile={company.forwardNumber ?? user.phone} />;
  if (step === "test") {
    const num = await withSystem((tx) => companyNumber(tx, company.id));
    body = num ? <TestStep locale={locale} number={num.e164} simulated={num.provider === "mock"} /> : <PhoneStep locale={locale} mobile={company.forwardNumber} />;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <div className="flex items-center justify-between">
        <Logo />
        <span className="text-sm text-slate-500">{t.onboarding.timer(MINUTES_LEFT[step])}</span>
      </div>
      <ol className="mt-6 grid grid-cols-5 gap-1.5" aria-label={t.onboarding.title}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <form action={goToStep}>
              <input type="hidden" name="step" value={s} />
              <button
                disabled={i > idx}
                aria-current={i === idx ? "step" : undefined}
                className="group flex w-full flex-col items-start gap-1.5 text-left disabled:cursor-default"
              >
                <span className={clsx("h-1.5 w-full rounded-full", i < idx ? "bg-brand-600" : i === idx ? "bg-brand-400" : "bg-slate-200")} />
                <span className={clsx("flex items-center gap-1 text-[11px] font-medium sm:text-xs", i <= idx ? "text-slate-800" : "text-slate-400")}>
                  {i < idx && <Check className="h-3 w-3 text-brand-600" aria-hidden />}
                  {t.onboarding.steps[s]}
                </span>
              </button>
            </form>
          </li>
        ))}
      </ol>
      <Card className="mt-6 p-5 sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">{titles[step]}</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">{intros[step]}</p>
        {body}
      </Card>
    </main>
  );
}

import { requireCompany } from "@/lib/auth/current";
import { features } from "@/lib/env";
import { PageHeader } from "@/components/ui";
import { Simulator } from "@/components/test-agent/simulator";

export const metadata = { title: "Test AI-en" };

export default async function TestAgentPage() {
  const { t, locale } = await requireCompany("onboarding");
  return (
    <div className="max-w-2xl">
      <PageHeader title={t.testAgent.title} />
      <Simulator locale={locale} aiReady={features.ai()} />
    </div>
  );
}

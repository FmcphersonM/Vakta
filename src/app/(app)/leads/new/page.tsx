import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { jobTypes } from "@/lib/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { LeadForm } from "@/components/leads/lead-form";

export default async function NewLeadPage() {
  const { t, company, locale } = await requireCompany();
  const types = await withTenant(company.id, (tx) => tx.select({ name: jobTypes.name }).from(jobTypes).where(eq(jobTypes.active, true)));
  return (
    <div className="max-w-2xl">
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t.leads.title}
      </Link>
      <PageHeader title={t.leads.newLead} />
      <Card className="p-4 sm:p-6">
        <LeadForm locale={locale} jobTypeNames={types.map((x) => x.name)} />
      </Card>
    </div>
  );
}

import { eq } from "drizzle-orm";
import { requireCompany } from "@/lib/auth/current";
import { teamMembers } from "@/lib/queries/calendar";
import { withTenant } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Kalender" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { t, company, locale, user } = await requireCompany();
  const sp = await searchParams;
  const members = await teamMembers(company.id);
  let prefill = null;
  if (sp.lead && /^[0-9a-f-]{36}$/.test(sp.lead)) {
    const leadId = sp.lead;
    const [l] = await withTenant(company.id, (tx) => tx.select().from(leads).where(eq(leads.id, leadId)));
    if (l) prefill = { leadId: l.id, name: l.name, phone: l.phone, address: l.address, title: l.jobTypeText ?? "" };
  }
  return (
    <div>
      <PageHeader title={t.calendar.title} />
      <CalendarView
        locale={locale}
        tz={company.timezone}
        members={members.map((m) => ({ userId: m.userId, name: m.name, color: m.color, doesBefaring: m.doesBefaring }))}
        businessHours={company.businessHours}
        befaringMinutes={company.befaringMinutes}
        prefill={prefill}
        currentUserId={user.id}
      />
    </div>
  );
}

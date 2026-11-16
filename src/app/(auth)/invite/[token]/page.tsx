import { eq } from "drizzle-orm";
import { withSystem } from "@/lib/db/client";
import { companies } from "@/lib/db/schema";
import { getCurrentSession, publicLocale } from "@/lib/auth/current";
import { dict } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { findInvite } from "../actions";
import { InviteAcceptForm } from "./form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await publicLocale();
  const t = dict(locale);
  const inv = await findInvite(token);
  if (!inv) return <Card className="p-6 text-center text-slate-700">{t.auth.inviteInvalid}</Card>;
  const [company] = await withSystem((tx) => tx.select({ name: companies.name }).from(companies).where(eq(companies.id, inv.companyId)));
  const cur = await getCurrentSession();
  const signedInAsInvitee = !!cur && cur.user.email.toLowerCase() === inv.email.toLowerCase();
  return <InviteAcceptForm locale={locale} token={token} company={company?.name ?? ""} email={inv.email} needsAccount={!signedInAsInvitee} />;
}

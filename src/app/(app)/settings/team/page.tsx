import { and, desc, gt, isNull } from "drizzle-orm";
import { requireCompany, canManage } from "@/lib/auth/current";
import { teamMembers } from "@/lib/queries/calendar";
import { withTenant } from "@/lib/db/client";
import { invitations } from "@/lib/db/schema";
import { Badge, Card, CardHeader, Initials, Select, buttonClass } from "@/components/ui";
import { SettingsPage } from "@/components/settings/shell";
import { InviteForm } from "@/components/settings/forms";
import { removeMember, revokeInvite, updateMember } from "@/app/(app)/_actions/settings";
import { ShieldCheck } from "lucide-react";

export default async function Page() {
  const ctx = await requireCompany();
  const { t, company, locale, user } = ctx;
  const members = await teamMembers(company.id);
  const invites = await withTenant(company.id, (tx) =>
    tx.select().from(invitations).where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))).orderBy(desc(invitations.createdAt)),
  );
  const manage = canManage(ctx);
  return (
    <SettingsPage title={t.settings.sections.team} back={t.settings.title} intro={t.settings.sectionHints.team}>
      <Card>
        <CardHeader title={t.settings.team.members} />
        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <li key={m.userId} className="px-4 py-3 sm:px-5">
              <form action={updateMember} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="userId" value={m.userId} />
                <Initials name={m.name} color={m.color} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium text-slate-900">
                    {m.name} {m.userId === user.id && <span className="text-xs font-normal text-slate-400">({t.settings.team.you})</span>}
                    {m.totp && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="2FA" />}
                  </p>
                  <p className="truncate text-sm text-slate-500">{m.email}</p>
                </div>
                {manage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select name="role" defaultValue={m.role} className="!w-auto !py-1.5 text-sm" aria-label={t.settings.team.role}>
                      {(["owner", "admin", "member"] as const).map((r) => (
                        <option key={r} value={r}>{t.settings.team.roles[r]}</option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input type="checkbox" name="doesBefaring" defaultChecked={m.doesBefaring} className="h-4 w-4 accent-brand-700" />
                      {t.settings.team.doesBefaring}
                    </label>
                    <input type="color" name="color" defaultValue={m.color} className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent" aria-label="Farge" />
                    <button className={buttonClass("secondary", "sm")}>{t.common.save}</button>
                  </div>
                ) : (
                  <Badge>{t.settings.team.roles[m.role]}</Badge>
                )}
              </form>
              {manage && m.userId !== user.id && (
                <form action={removeMember} className="mt-1 flex justify-end">
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="text-xs text-slate-500 hover:text-red-700">{t.settings.team.remove}</button>
                </form>
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Initials name={i.email} color="#94a3b8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-700">{i.email}</p>
                <Badge tone="amber">{t.settings.team.pending}</Badge>
              </div>
              {manage && (
                <form action={revokeInvite}>
                  <input type="hidden" name="id" value={i.id} />
                  <button className="text-xs text-slate-500 hover:text-red-700">{t.common.delete}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {manage && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold text-slate-900">{t.settings.team.invite}</h2>
          <InviteForm locale={locale} />
        </Card>
      )}
    </SettingsPage>
  );
}

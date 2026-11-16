import Link from "next/link";
import { AlertTriangle, LogOut, Sparkles } from "lucide-react";
import { requireCompany } from "@/lib/auth/current";
import { attentionCount } from "@/lib/queries/dashboard";
import { serviceState } from "@/lib/billing/status";
import { BottomNav, SideNav, type NavItem } from "@/components/shell/nav";
import { Logo, LogoMark } from "@/components/logo";
import { logoutAction } from "@/app/(auth)/actions";
import { buttonClass } from "@/components/ui";
import { Banner } from "@/components/shell/banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompany("no2fa");
  const { t, company, user } = ctx;
  const attention = await attentionCount(company.id);
  const svc = serviceState(company);

  const items: NavItem[] = [
    { key: "today", href: "/today", label: t.nav.today, badge: attention },
    { key: "calendar", href: "/calendar", label: t.nav.calendar },
    { key: "leads", href: "/leads", label: t.nav.leads },
    { key: "calls", href: "/calls", label: t.nav.calls },
    { key: "settings", href: "/settings", label: t.nav.settings },
  ];

  return (
    <div className="lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Link href="/today" className="px-2">
          <Logo />
        </Link>
        <p className="mt-4 truncate px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{company.name}</p>
        <div className="mt-2 flex-1">
          <SideNav items={items} />
          <Link href="/test-agent" className={buttonClass("secondary", "md", "mt-6 w-full")}>
            <Sparkles className="h-4 w-4" aria-hidden /> {t.nav.testAgent}
          </Link>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <p className="truncate px-2 text-sm font-medium text-slate-800">{user.name}</p>
          <p className="truncate px-2 text-xs text-slate-500">{user.email}</p>
          <form action={logoutAction} className="mt-2">
            <button className={buttonClass("ghost", "sm", "w-full justify-start")}>
              <LogOut className="h-4 w-4" aria-hidden /> {t.nav.logout}
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <Link href="/today" className="flex min-w-0 items-center gap-2">
          <LogoMark className="h-7 w-7 shrink-0" />
          <span className="truncate text-[0.95rem] font-semibold text-slate-900">{company.name}</span>
        </Link>
        <Link href="/test-agent" className={buttonClass("secondary", "sm", "shrink-0")} aria-label={t.nav.testAgent}>
          <Sparkles className="h-4 w-4" aria-hidden />
          <span className="hidden min-[400px]:inline">{t.nav.testAgent}</span>
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 sm:px-6 lg:pb-12 lg:pt-8">
        {!svc.active && (
          <Banner tone="red" icon={<AlertTriangle className="h-4 w-4" />} cta={<Link href="/settings/billing" className="font-semibold underline">{t.banners.inactiveCta}</Link>}>
            {t.banners.inactive}
          </Banner>
        )}
        {svc.status === "past_due" && svc.active && (
          <Banner tone="amber" icon={<AlertTriangle className="h-4 w-4" />} cta={<Link href="/settings/billing" className="font-semibold underline">{t.settings.billing.manage}</Link>}>
            {t.banners.pastDue}
          </Banner>
        )}
        {svc.active && svc.trialDaysLeft !== null && svc.trialDaysLeft <= 7 && (
          <Banner tone="brand" icon={<Sparkles className="h-4 w-4" />} cta={<Link href="/settings/billing" className="font-semibold underline">{t.banners.trialCta}</Link>}>
            {t.banners.trial(svc.trialDaysLeft)}
          </Banner>
        )}
        {children}
      </main>

      <BottomNav items={items} />
    </div>
  );
}

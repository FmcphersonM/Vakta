"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { CalendarDays, Home, Inbox, PhoneIncoming, Settings } from "lucide-react";

const ICONS = { today: Home, calendar: CalendarDays, leads: Inbox, calls: PhoneIncoming, settings: Settings } as const;
export type NavKey = keyof typeof ICONS;
export type NavItem = { key: NavKey; href: string; label: string; badge?: number };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1" aria-label="Hovedmeny">
      {items.map((it) => {
        const Icon = ICONS[it.key];
        const active = isActive(pathname, it.href);
        return (
          <Link
            key={it.key}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-brand-700 text-white" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="flex-1">{it.label}</span>
            {!!it.badge && (
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-900",
                )}
              >
                {it.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hovedmeny"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((it) => {
          const Icon = ICONS[it.key];
          const active = isActive(pathname, it.href);
          return (
            <li key={it.key}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium",
                  active ? "text-brand-700" : "text-slate-500",
                )}
              >
                <Icon className={clsx("h-6 w-6", active && "stroke-[2.25]")} aria-hidden />
                <span className="max-w-full truncate px-0.5">{it.label}</span>
                {!!it.badge && (
                  <span className="absolute right-[22%] top-2 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-bold leading-4 text-white">
                    {it.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

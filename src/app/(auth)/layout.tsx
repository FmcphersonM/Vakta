import { Logo } from "@/components/logo";
import { publicLocale } from "@/lib/auth/current";
import { dict } from "@/lib/i18n";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = dict(await publicLocale());
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-1">
        <Logo />
        <p className="text-sm text-slate-500">{t.appTagline}</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

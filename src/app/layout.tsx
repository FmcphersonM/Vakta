import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentSession, publicLocale } from "@/lib/auth/current";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "Vakta";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "AI-resepsjonist for håndverkere – svarer telefonen og booker befaringer.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1f5f64",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cur = await getCurrentSession();
  const lang = cur?.user.locale === "en" ? "en" : cur ? "nb" : await publicLocale();
  return (
    <html lang={lang === "en" ? "en" : "nb"}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

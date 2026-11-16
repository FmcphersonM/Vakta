import { VerifyForm } from "@/components/auth/forms";
import { publicLocale } from "@/lib/auth/current";

export default async function Page() {
  const locale = await publicLocale();
  return <VerifyForm locale={locale} />;
}

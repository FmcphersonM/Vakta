import { ResetForm } from "@/components/auth/forms";
import { publicLocale } from "@/lib/auth/current";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await publicLocale();
  return <ResetForm locale={locale} token={token} />;
}

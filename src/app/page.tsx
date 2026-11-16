import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current";

export default async function Home() {
  const cur = await getCurrentSession();
  redirect(cur ? "/today" : "/login");
}

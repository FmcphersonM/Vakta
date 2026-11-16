import { randomUUID } from "node:crypto";
import { signup } from "@/lib/auth/signup";

export async function makeCompany(overrides: { name?: string; trade?: "plumber" | "electrician" } = {}) {
  const tag = randomUUID().slice(0, 8);
  const email = `owner-${tag}@example.no`;
  const password = "riktig-passord-123";
  const ids = await signup({
    companyName: overrides.name ?? `Testfirma ${tag}`,
    name: `Eier ${tag}`,
    email,
    password,
    trade: overrides.trade ?? "plumber",
  });
  return { ...ids, email, password };
}

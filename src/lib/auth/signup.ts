import { eq, like } from "drizzle-orm";
import { withSystem } from "../db/client";
import { companies, dpaAcceptances, jobTypes, memberships, users } from "../db/schema";
import { hashPassword } from "./password";
import { slugify } from "../slug";
import { DEFAULT_JOB_TYPES, type Trade } from "../trades";
import { audit } from "../audit";

export const DPA_VERSION = "2026-11-v1";

export class EmailTakenError extends Error {}

export async function signup(input: {
  companyName: string;
  name: string;
  email: string;
  password: string;
  trade: Trade;
  locale?: "nb" | "en";
  ip?: string | null;
}): Promise<{ companyId: string; userId: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  return withSystem(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) throw new EmailTakenError(email);

    const base = slugify(input.companyName);
    const taken = new Set(
      (await tx.select({ slug: companies.slug }).from(companies).where(like(companies.slug, `${base}%`))).map((r) => r.slug),
    );
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

    const [company] = await tx
      .insert(companies)
      .values({
        name: input.companyName.trim(),
        slug,
        trade: input.trade,
        email,
        locale: input.locale ?? "nb",
        greetingText: input.locale === "en" ? "How can I help you?" : "Hva kan jeg hjelpe deg med?",
      })
      .returning({ id: companies.id });
    const [user] = await tx
      .insert(users)
      .values({ email, name: input.name.trim(), passwordHash, locale: input.locale ?? "nb" })
      .returning({ id: users.id });

    await tx.insert(memberships).values({ companyId: company.id, userId: user.id, role: "owner", doesBefaring: true });
    await tx.insert(dpaAcceptances).values({ companyId: company.id, userId: user.id, version: DPA_VERSION, ip: input.ip ?? null });
    const defaults = DEFAULT_JOB_TYPES[input.trade] ?? DEFAULT_JOB_TYPES.general;
    await tx.insert(jobTypes).values(
      defaults.map((j, i) => ({ companyId: company.id, name: j.name, description: j.description, sort: i })),
    );
    await audit(tx, {
      companyId: company.id,
      userId: user.id,
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      metadata: { dpaVersion: DPA_VERSION },
      ip: input.ip,
    });
    return { companyId: company.id, userId: user.id };
  });
}

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireCompany } from "@/lib/auth/current";
import { withTenant } from "@/lib/db/client";
import { calls } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

export async function markCallReviewed(form: FormData) {
  const ctx = await requireCompany();
  const id = z.string().uuid().parse(form.get("id"));
  await withTenant(ctx.company.id, async (tx) => {
    await tx.update(calls).set({ reviewedAt: new Date(), flagged: false }).where(eq(calls.id, id));
    await audit(tx, { companyId: ctx.company.id, userId: ctx.user.id, action: "call.reviewed", entityType: "call", entityId: id });
  });
  revalidatePath("/today");
  revalidatePath("/calls");
  revalidatePath(`/calls/${id}`);
}

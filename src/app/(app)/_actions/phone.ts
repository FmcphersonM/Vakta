"use server";

import { revalidatePath } from "next/cache";
import { assertManager, requireCompany } from "@/lib/auth/current";
import { assignNumber } from "@/lib/telephony/numbers";
import type { ActionState } from "@/components/ui/form";

export async function getNumberAction(): Promise<ActionState> {
  const ctx = await requireCompany("onboarding");
  assertManager(ctx);
  try {
    await assignNumber(ctx.company.id, ctx.user.id);
  } catch (e) {
    console.error(e);
    return { error: ctx.t.common.error };
  }
  revalidatePath("/settings/phone");
  revalidatePath("/onboarding");
  return { ok: true };
}

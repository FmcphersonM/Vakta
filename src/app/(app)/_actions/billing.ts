"use server";

import { redirect } from "next/navigation";
import { assertManager, requireCompany } from "@/lib/auth/current";
import { features } from "@/lib/env";
import { createCheckoutSession, createPortalSession } from "@/lib/billing/stripe";

export async function startSubscription() {
  const ctx = await requireCompany("no2fa");
  assertManager(ctx);
  if (!features.stripe()) throw new Error("stripe_not_configured");
  redirect(await createCheckoutSession(ctx.company, ctx.user.email));
}

export async function openBillingPortal() {
  const ctx = await requireCompany("no2fa");
  assertManager(ctx);
  if (!features.stripe() || !ctx.company.stripeCustomerId) throw new Error("no_customer");
  redirect(await createPortalSession(ctx.company));
}

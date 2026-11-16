import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "../db/client";
import { companies, stripeEvents, type Company } from "../db/schema";
import { env } from "../env";
import { audit } from "../audit";

let client: Stripe | undefined;
export function stripe() {
  client ??= new Stripe(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, appInfo: { name: env().NEXT_PUBLIC_APP_NAME } });
  return client;
}

const STATUS: Record<string, Company["subscriptionStatus"]> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
};

/** Stripe Checkout for the monthly plan. Unused free-trial days carry over. */
export async function createCheckoutSession(company: Company, userEmail: string) {
  const s = stripe();
  let customerId = company.stripeCustomerId;
  if (!customerId) {
    const customer = await s.customers.create({
      name: company.name,
      email: company.email ?? userEmail,
      metadata: { companyId: company.id, orgNumber: company.orgNumber ?? "" },
      preferred_locales: [company.locale === "en" ? "en" : "nb"],
    });
    customerId = customer.id;
    await withTenant(company.id, (tx) => tx.update(companies).set({ stripeCustomerId: customerId }).where(eq(companies.id, company.id)));
  }
  // Stripe needs a trial end at least 48 h ahead; otherwise billing starts now.
  const trialEnd = company.subscriptionStatus === "trialing" && company.trialEndsAt.getTime() > Date.now() + 49 * 3600_000 ? Math.floor(company.trialEndsAt.getTime() / 1000) : undefined;
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env().STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { metadata: { companyId: company.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    client_reference_id: company.id,
    locale: company.locale === "en" ? "en" : "nb",
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { name: "auto", address: "auto" },
    allow_promotion_codes: true,
    success_url: `${env().APP_URL}/settings/billing?success=1`,
    cancel_url: `${env().APP_URL}/settings/billing`,
  });
  return session.url!;
}

export async function createPortalSession(company: Company) {
  const r = await stripe().billingPortal.sessions.create({ customer: company.stripeCustomerId!, return_url: `${env().APP_URL}/settings/billing` });
  return r.url;
}

async function companyIdFor(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.companyId) return sub.metadata.companyId;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [row] = await withSystem((tx) => tx.select({ id: companies.id }).from(companies).where(eq(companies.stripeCustomerId, customer)));
  return row?.id ?? null;
}

export async function applySubscription(sub: Stripe.Subscription) {
  const companyId = await companyIdFor(sub);
  if (!companyId) return;
  const periodEnd = sub.items?.data?.[0]?.current_period_end;
  const status = STATUS[sub.status] ?? "incomplete";
  await withSystem(async (tx) => {
    await tx
      .update(companies)
      .set({
        subscriptionStatus: status,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        ...(sub.status === "trialing" && sub.trial_end ? { trialEndsAt: new Date(sub.trial_end * 1000) } : {}),
      })
      .where(eq(companies.id, companyId));
    await audit(tx, { companyId, actor: "system", action: "billing.subscription", metadata: { status, subscription: sub.id } });
  });
}

/** Handles one verified Stripe event, at most once (idempotent by event id). */
export async function handleStripeEvent(event: Stripe.Event) {
  const fresh = await withSystem((tx) => tx.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning());
  if (!fresh.length) return "duplicate";
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.subscription) {
        const sub = await stripe().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
        await applySubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await applySubscription(event.data.object);
      break;
  }
  return "ok";
}

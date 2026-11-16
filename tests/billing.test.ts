import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { closeDb, withTenant } from "@/lib/db/client";
import { companies } from "@/lib/db/schema";
import { serviceState } from "@/lib/billing/status";
import { resetEnvCache } from "@/lib/env";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { makeCompany } from "./helpers";

const SECRET = "whsec_test_secret";
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_PRICE_ID = "price_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  resetEnvCache();
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = "";
  resetEnvCache();
  await closeDb();
});

const signer = new Stripe("sk_test_dummy");
function stripeRequest(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload });
}
const subEvent = (id: string, type: string, companyId: string, status: string, periodEnd = 1893456000) => ({
  id,
  object: "event",
  type,
  data: {
    object: {
      id: "sub_123",
      object: "subscription",
      customer: "cus_123",
      status,
      metadata: { companyId },
      trial_end: null,
      items: { data: [{ current_period_end: periodEnd }] },
    },
  },
});

describe("Stripe webhook", () => {
  it("rejects requests that are not signed by Stripe", async () => {
    const res = await webhook(stripeRequest({ id: "evt_x", type: "customer.subscription.updated", data: { object: {} } }, "whsec_wrong"));
    expect(res.status).toBe(400);
  });

  it("activates the subscription, ignores replays, and handles cancellation", async () => {
    const c = await makeCompany();
    const evId = `evt_${crypto.randomUUID()}`;
    const r1 = await webhook(stripeRequest(subEvent(evId, "customer.subscription.updated", c.companyId, "active")));
    expect(await r1.json()).toEqual({ received: true, result: "ok" });
    let [co] = await withTenant(c.companyId, (tx) => tx.select().from(companies).where(eq(companies.id, c.companyId)));
    expect(co).toMatchObject({ subscriptionStatus: "active", stripeSubscriptionId: "sub_123", stripeCustomerId: "cus_123" });
    expect(co.currentPeriodEnd?.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    expect(serviceState(co).active).toBe(true);

    const replay = await webhook(stripeRequest(subEvent(evId, "customer.subscription.updated", c.companyId, "canceled")));
    expect((await replay.json()).result).toBe("duplicate");

    await webhook(stripeRequest(subEvent(`evt_${crypto.randomUUID()}`, "customer.subscription.deleted", c.companyId, "canceled")));
    [co] = await withTenant(c.companyId, (tx) => tx.select().from(companies).where(eq(companies.id, c.companyId)));
    expect(co.subscriptionStatus).toBe("canceled");
    expect(serviceState(co).active).toBe(false);
  });
});

describe("who may use the AI", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const day = 86400_000;
  it("trial: active until the trial ends", () => {
    expect(serviceState({ subscriptionStatus: "trialing", trialEndsAt: new Date(now.getTime() + 3 * day), currentPeriodEnd: null }, now)).toEqual({ active: true, trialDaysLeft: 3, status: "trialing" });
    expect(serviceState({ subscriptionStatus: "trialing", trialEndsAt: new Date(now.getTime() - 1000), currentPeriodEnd: null }, now).active).toBe(false);
  });
  it("past due: a 7-day grace period after the period ended", () => {
    const pe = new Date(now.getTime() - 3 * day);
    expect(serviceState({ subscriptionStatus: "past_due", trialEndsAt: now, currentPeriodEnd: pe }, now).active).toBe(true);
    expect(serviceState({ subscriptionStatus: "past_due", trialEndsAt: now, currentPeriodEnd: new Date(now.getTime() - 8 * day) }, now).active).toBe(false);
  });
  it("canceled/unpaid: not active", () => {
    expect(serviceState({ subscriptionStatus: "unpaid", trialEndsAt: now, currentPeriodEnd: null }, now).active).toBe(false);
  });
});

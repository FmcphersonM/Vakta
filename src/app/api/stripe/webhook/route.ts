import type Stripe from "stripe";
import { env } from "@/lib/env";
import { handleStripeEvent, stripe } from "@/lib/billing/stripe";

/** Stripe → Vakta. The raw body is verified with the webhook signing secret. */
export async function POST(req: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!secret || !env().STRIPE_SECRET_KEY) return new Response("Stripe not configured", { status: 503 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  const result = await handleStripeEvent(event);
  return Response.json({ received: true, result });
}

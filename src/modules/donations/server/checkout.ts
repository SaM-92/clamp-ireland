import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

/** Preset one-time contribution amounts shown to supporters, in EUR. */
export const SUPPORT_PRESETS_EUR = [3, 5, 10, 20] as const;
const MIN_AMOUNT_EUR = 1;
const MAX_AMOUNT_EUR = 500;

export function isSupportConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

let client: Stripe | undefined;
function stripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

/** Creates a Stripe-hosted Checkout Session for a one-time EUR contribution and
 * returns its hosted URL. Card details never reach this app - see
 * docs/10-support-payments.md for why a hosted checkout was chosen. */
export async function createSupportCheckoutSession(amountEur: number, origin: string): Promise<string> {
  if (!Number.isFinite(amountEur) || amountEur < MIN_AMOUNT_EUR || amountEur > MAX_AMOUNT_EUR) {
    throw new Error(`Choose an amount between \u20ac${MIN_AMOUNT_EUR} and \u20ac${MAX_AMOUNT_EUR}.`);
  }
  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    // Managed Payments (Stripe's merchant-of-record/tax mode) requires a
    // product tax code we don't have for a simple donation; use direct
    // charges instead, same as a standard Payment Link would.
    managed_payments: { enabled: false },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: Math.round(amountEur * 100),
        product_data: {
          name: "Support clamptracker.ie",
          description: "A one-time contribution to keep the community clamping map free and running.",
        },
      },
    }],
    success_url: `${origin}/support/thanks`,
    cancel_url: `${origin}/support/cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

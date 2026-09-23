import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

/** The single product Stripe review approved: one "coffee" is €5, and
 * supporters buy 1-99 of them (matches the Payment Link already configured
 * in the Stripe dashboard, including its product tax code). */
export const COFFEE_PRICE_EUR = 5;
export const MAX_COFFEES = 99;
/** Preset contribution amounts shown to supporters, in EUR (multiples of
 * COFFEE_PRICE_EUR - each is really "buy N coffees"). */
export const SUPPORT_PRESETS_EUR = [5, 10, 20, 50] as const;

export function isSupportConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

let client: Stripe | undefined;
function stripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

/** Creates a Stripe-hosted Checkout Session for 1-99 "coffees" at a fixed
 * €5 each and returns its hosted URL. Card details never reach this app -
 * see docs/10-support-payments.md for why a hosted checkout was chosen.
 * amountEur must be a whole-euro multiple of COFFEE_PRICE_EUR; it is
 * converted to a Stripe line-item quantity, since Stripe prices are fixed
 * per unit and only quantity can vary. */
export async function createSupportCheckoutSession(amountEur: number, origin: string): Promise<string> {
  const quantity = amountEur / COFFEE_PRICE_EUR;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COFFEES) {
    throw new Error(`Choose a multiple of \u20ac${COFFEE_PRICE_EUR}, up to \u20ac${COFFEE_PRICE_EUR * MAX_COFFEES} (${MAX_COFFEES} coffees).`);
  }
  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    // Managed Payments (Stripe's merchant-of-record/tax mode) needs a
    // product tax code we don't have for this dynamically-created line item;
    // use direct charges instead, same as a standard Payment Link would.
    managed_payments: { enabled: false },
    line_items: [{
      quantity,
      price_data: {
        currency: "eur",
        unit_amount: COFFEE_PRICE_EUR * 100,
        product_data: {
          name: "Buy me a coffee",
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


# Support payments: recommendation and setup handoff

Researched against official provider documentation on 22 September 2026.
No payment account, checkout or subscription has been created.

## Recommended starting point

Use a **Stripe-hosted Payment Link**, in EUR, for a one-time
customer-chosen amount. This needs no payment form, card storage, webhook
or payment SDK in this repository. Apple Pay and Google Pay are payment
methods offered by the checkout, not alternatives to having a processor.
Eligible supporters can use a wallet; others can use supported cards.
Wallet visibility depends on device, browser, account and payment settings,
so do not promise that every visitor will see both buttons.

Stripe's published Ireland Standard pricing currently lists no setup or
monthly fee, with **1.5% + EUR 0.25 for standard EEA cards**. For that card
category, a EUR 10 contribution leaves approximately EUR 9.60 before any
other applicable charges. Other cards, conversion and disputes can cost
more. Recheck current pricing rather than treating this as a fixed promise.

## Alternatives

| Option | Fit | Main cost consideration |
|---|---|---|
| Stripe Payment Link | Simplest hosted checkout, custom one-time amounts and eligible wallets | Processing fees; no separate creator-platform percentage on standard Payment Links |
| Ko-fi Free | Ready-made supporter page and messages, payments to your connected Stripe/PayPal | Free mode advertises 0% platform fee on one-time tips; processor fees still apply; other features/plans differ |
| Buy Me a Coffee | Familiar creator-support page | Published 5% platform fee plus applicable processing/payout charges |
| GitHub Sponsors | Support for eligible open-source contributors | Individual-account sponsorships have no GitHub fee, but eligibility and a developer-oriented supporter audience make this less suitable as the only option |

The research confirmed Ireland in Buy Me a Coffee's payout-country list and
GitHub Sponsors' supported regions. Ko-fi availability relies on a supported
connected processor; an explicit Ireland availability statement and current
wallet coverage were not verified. Do not advertise those as confirmed.

## Activation steps

1. The owner opens an appropriate Stripe account and completes required
   identity/business and payout verification. Confirm eligibility for the
   intended voluntary-support activity.
2. Create a one-time Payment Link using customer-chosen pricing, in EUR,
   with sensible amount bounds. Recurring support is a separate decision;
   do not silently subscribe contributors.
3. Use clear wording such as "Support this community project". Explain
   what contributions fund and provide contact/refund information. Do not
   imply registered-charity status or tax deductibility.
4. Test the hosted checkout using Stripe's supported test process, including
   wallet-eligible and card-only browsers.
5. Set the real hosted URL in `NEXT_PUBLIC_DONATION_URL` and redeploy.
   The existing `DonateButton` already supports an external hosted link.
   Never put Stripe secret keys into public environment variables.
6. Explain the processor's involvement in the privacy notice. Ask Revenue
   or an accountant about the particular income/tax treatment; it is not
   established by calling payments "tips" or "donations".

Until that setup is complete, the site's support control intentionally
remains an inactive placeholder. A public link alone does not justify
claiming the site can take payments.

## Sources

- Ireland pricing: https://stripe.com/ie/pricing
- Hosted links: https://docs.stripe.com/payment-links
- Customer-chosen amounts: https://docs.stripe.com/payments/checkout/pay-what-you-want
- Wallets: https://docs.stripe.com/apple-pay and https://docs.stripe.com/google-pay
- Ko-fi fees: https://help.ko-fi.com/hc/en-us/articles/360002506494
- Buy Me a Coffee fees: https://help.buymeacoffee.com/en/articles/8105744
- Buy Me a Coffee payout countries: https://help.buymeacoffee.com/en/articles/6258038
- GitHub Sponsors: https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors

This is a provider-selection handoff, not tax/legal advice or a commitment
to pay for a service. Hosted checkout reduces application complexity but
does not remove the owner's account, privacy, refund or dispute obligations.

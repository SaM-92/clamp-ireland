# Separate private administration website

The owner approved a separate **internet-reachable, login-protected** website,
not a VPN-only site. Its sign-in screen can be reached by others; protected
pages and administrative APIs require one of the two approved identities.
This changes local source structure and authorization, not Azure resources.

## Application boundary

| Application | Routes | Local command |
|---|---|---|
| Community (`src/app`) | Map, reporting, votes, public summaries, appeal and community authentication | `npm run dev -- --port 3001` |
| Administration (`apps/admin/src/app`) | Private overview, moderation, summary review, traffic reads and administrator sessions | `npm run dev:admin` (port 3003) |

The apps have independent route manifests, build output, layouts, origins and
environment files, while sharing `src/modules` and `src/lib`. No duplicated
moderation/scoring repositories or cross-origin administration proxy was added.
Public `/admin`, `/api/admin/*` and `/api/moderation/*` paths return 404, including
when a caller supplies valid administrator credentials. The public footer
contains no admin link. This is route separation, not merely hiding a button
or checking an untrusted Host header.

Run `npm run build:all` to build both, or `build` / `build:admin` independently.
`npm run start:admin` runs the built admin app. No standalone deployment,
resource provisioning, Blob migration or database migration was executed.

## Access policy

The shared `requireAdmin` helper verifies every administrative request:

1. Valid admin configuration is present.
2. Supabase verifies the token and the account's confirmed email.
3. The immutable account UUID is in the server-side two-account allowlist.
4. The current profile has `is_admin === true` and `is_banned === false`.

Exactly two distinct UUIDs are required; empty, duplicate, malformed, extra or
email-address entries fail closed. A third account is denied even if its
database profile has `is_admin=true`. Request bodies, query parameters and
identity-looking proxy headers cannot choose the acting administrator.
Identity/profile requests explicitly bypass fetch caching.

Every protected page and its layout call the server gate before rendering.
The layout alone is not relied on for client navigation. APIs independently
gate reads and writes, including location choices and disabled feature states.
There is no sign-up route or client-settable administrator grant.

The former no-auth local admin preview was removed, including its helper and
dashboard branch. Public local report storage never grants admin access.

## Sessions and browser behavior

The dedicated sign-in accepts existing email/password accounts, verifies
administrator authorization, then sets an **HttpOnly, host-only, SameSite
Strict** cookie. HTTPS uses a Secure `__Host-` cookie with Path `/` and no
Domain attribute. Loopback HTTP uses a development-compatible cookie name.
The JWT is not returned in JSON or placed in admin browser storage.

Session lifetime is the shorter of the provider's expiry and one hour.
There is no stored refresh token or automatic renewal; sign in again after
expiry. Clearing a cookie does not invalidate a previously stolen bearer JWT;
expiry and the rechecked allowlist/profile are the server-side revocation
controls. Prefer dedicated admin identities, and assess MFA before launch.
Google OAuth on the community site is unchanged; it is not an administrator
sign-in option in this increment.

Cookie-authenticated mutations require the exact configured `ADMIN_SITE_URL`
Origin, and reject cross-site Fetch Metadata. Sign-in and sign-out also enforce
Origin. Existing bearer-token callers still require the same verified
allowlisted identity; their credentials are not authorized merely by knowing
the admin URL. There are no permissive cross-origin response headers.

Sign-out clears the cookie and other open admin tabs. Session checks run on
returning to the tab and periodically; failed verification hides private UI.
Successful checks preserve unsaved edits. This does not replace API checks or
promise that previously viewed information can be erased from a browser.

Responses are private/no-store and noindex. Framing is denied and referrers
are suppressed. These headers are defense-in-depth, not authentication.
The admin layout does not mount the public pageview tracker or donation UI.
Model credentials belong only to the admin runtime. Public reviewed-summary
reads require their own opt-in flag and anonymous backend configuration, not
an OpenAI key or a service-role key.

## Owner setup, only when backend configuration is approved

1. Create/confirm two email/password identities in the selected Supabase
   project. Prefer dedicated administrative accounts.
2. Through trusted database administration, set only those profiles to
   `is_admin=true`, `is_banned=false`. Ordinary signup never grants this role.
3. Copy `apps/admin/.env.example` to its ignored `.env.local`. Configure the
   backend URL/keys independently, `ADMIN_ALLOWED_USER_IDS` with the two UUIDs,
   and `ADMIN_SITE_URL` with the exact origin. Use HTTPS off loopback.
4. Keep IDs, passwords, service keys and signing credentials out of git and
   public client variables. Do not put the allowlist in the community app.
5. Apply the approved migrations and configure storage/provider settings
   before using the review tools. Summary generation and analytics stay opt-in.

No real accounts or allowlist values were supplied/configured in this change.
The ordinary local admin site therefore shows a locked setup/sign-in screen,
not the private dashboard. No backdoor was introduced to demonstrate it.

## Verification approach

`tests/admin-access.spec.ts` exercises the real gate and sign-in route with
only the external identity/database transport mocked. It covers allowlist
cardinality, confirmation, role/ban/revocation, unavailable configuration,
cookie attributes, bounded expiry, Origin rules and identity-header spoofing.

Playwright starts `tests/helpers/admin-test-server.mjs` on loopback port 3016.
It substitutes a local Supabase-shaped identity/database endpoint, not app
authorization. Both accepted fixture identities and a third admin-profile
identity go through the real page/API gate. There is no production test mode.
Paid model calls are disabled and no cloud credentials are used by this fixture.

Stop the local admin dev server before these tests: both use the same
development build directory. Leave the community server available at port 3001.
After `npm run build:all`, set `PLAYWRIGHT_ADMIN_PRODUCTION=true` to exercise
the same real gates against the admin production build. Set
`PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_PRODUCTION=true` when the community
server under test is also a production build.
The tests verify route isolation, sign-in/out, denied private HTML, no preview
bypass, cross-tab sign-out, unsaved-edit preservation, phone layouts and the
existing moderation, image-failure, summary and traffic workflows.

Local verification completed: both production builds and ESLint passed; the
full development regression run passed 119 checks with two production-only
skips. Both production builds were also exercised together (47 checks passed,
seven development-only skips). A final 12-check run covered authorization and
the public-summary/no-admin-secrets boundary after splitting its setup logic.
The ordinary unconfigured admin server was independently confirmed to redirect
to locked sign-in, reject private API reads, and leave public `/admin` at 404.

Live Supabase auth, actual two-owner setup, physical devices and deployed TLS
remain unverified. No MFA, account-recovery UI, audit UI or network allowlist
was added. Service-role credentials remain powerful: separate apps are not
a replacement for future least-privilege database/storage credentials or
protecting the public server itself.

## Cross-origin freshness and future hosting

Browser BroadcastChannel events cannot cross between the admin and community
origins. Public summary freshness still relies on its server fingerprint gate,
30-second visible-dialog refresh and visibility refresh, not instant delivery
of an admin-tab broadcast.

Deploy each app to its own origin/runtime when explicitly approved. Their
settings must not be merged. Both runtimes share subscription-level free
allowances; a second deployment is not a second free tier. Handoff 13 remains
the provisional hosting/data recommendation, not permission to deploy.

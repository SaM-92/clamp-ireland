# Technical search / answer-engine handoff

## What ships

Only `/` and `/appeal` are public search destinations. No location pages,
sample reports, reviews, ratings or new factual claims were added. Existing
server-rendered content and anchors remain unchanged.

`src/modules/seo/policy.ts` centralises origin validation, indexing policy,
public metadata, robots, sitemap, WebSite structured data and request exclusions.
`config.ts` reads the parent's central `env.SITE_URL` and `env.ALLOW_INDEXING`.
The only additional central environment field is `VERCEL_ENV`, used to reject
preview/development deployments even when their Node runtime is production.

Indexing requires **all** of:

- `ALLOW_INDEXING=true` (the exact boolean opt-in recognised by central env).
- `SITE_URL` set to the verified public HTTPS origin, optionally with a trailing
  slash. No credentials, path, query, fragment, local/private IP or local/reserved
  hostname. IP literals are deliberately unsupported; use a public DNS name.
- `NODE_ENV=production`.
- `VERCEL_ENV` absent for non-Vercel hosting, or exactly `production`.

An explicit malformed `SITE_URL` throws an actionable `Invalid SITE_URL` error
even with indexing disabled. It never falls back to the request host or localhost.
Validation is syntactic; it does not establish DNS ownership or public reachability.

Absent configuration means noindex metadata/headers, a disallow-all robots file,
an empty sitemap, and no canonical URL or WebSite JSON-LD. When a valid origin is
configured, each public page has a self-referential canonical and Open Graph URL
on that origin, including on noindex previews. This is intentional: a configured
canonical does not override noindex. Title/description/OG text remains available
without a configured domain. Root metadata has no canonical, so auth/admin pages
do not accidentally inherit the homepage canonical.

The homepage's JSON-LD describes only a `WebSite` and only when an origin exists.
It claims no organisation, charity status, address, rating or reviews. Sitemap
entries contain only canonical `/` and `/appeal` URLs, with no fabricated lastmod.
Robots and sitemap routes are dynamic rather than build-time cached documents.

## Request and crawler boundaries

Next 16 `src/proxy.ts` adds `X-Robots-Tag: noindex, nofollow, noarchive` to
non-index-enabled responses, alternate-host responses and `/admin`, `/auth`,
`/api` route families. It compares HTTPS and the request Host authority with the
configured origin; `X-Forwarded-Host` cannot override that authority check.
There are no database calls in this proxy. The admin layout already supplied
noindex metadata; sign-in metadata now explicitly does too.

When indexing is enabled, robots permits public crawling (including
`OAI-SearchBot`) but excludes `/api` and its descendants. The OAI-specific group
repeats those exclusions because specific robot groups do not inherit wildcard
rules. Admin/auth **HTML is not disallowed**, so crawlers can read its noindex
meta/headers. API auth/moderation data is covered by the `/api` exclusion.
Robots and noindex are not authentication or access control. The existing backend
authorisation is unchanged. On intentionally closed previews, disallow-all may
prevent crawlers seeing noindex; it is not a removal guarantee for previously
indexed URLs.

`GPTBot` is disallowed by default. OpenAI documents OAI-SearchBot for search
separately from GPTBot for training; allowing search does not require allowing
GPTBot. Robots is a cooperative crawling policy, not a security/privacy barrier.

## Launch checklist (deployment owner)

1. Confirm the owned, reachable HTTPS domain and redirects to its chosen origin.
   Set `SITE_URL` to that origin and explicitly opt in with `ALLOW_INDEXING=true`
   only for the intended production deployment. Keep previews opted out. Rebuild
   and redeploy after changes so prerendered metadata and bundled configuration
   agree with runtime settings. Do not manually override the platform's
   `VERCEL_ENV`.
2. Verify real production responses for `/`, `/appeal`, `/robots.txt` and
   `/sitemap.xml`. Public pages should have correct canonical/OG URLs and no
   noindex directive on the intended host. Check homepage JSON-LD against visible
   content. Check preview/alternate hosts remain noindex, even with copied opt-in
   values, and admin/auth responses remain noindex.
3. Verify reverse-proxy/CDN Host and HTTPS forwarding and preservation of
   `X-Robots-Tag`. The host/protocol checks deliberately fail closed. A local or
   rewritten Host can keep a legitimate deployment noindex until hosting is
   corrected. An environment presented as production on the actual canonical
   host cannot be distinguished from production by application code alone.
4. Verify domain ownership in Google Search Console, inspect both public URLs,
   and submit the actual domain's `/sitemap.xml`. Review indexing reports and
   crawl accessibility. No deployment, account or Search Console settings were
   changed here.

Physical deployment/CDN checks, real-domain ownership, Search Console submission
and live crawler behaviour remain unavailable in this local implementation.
Technical eligibility is **not a ranking, indexing, AI inclusion or ChatGPT
citation guarantee**.

## Sources and AEO limits

Reviewed 22 September 2026, using researcher-verified official documentation:

- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.openai.com/api/docs/bots
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/block-indexing

Google's AI search features use ordinary SEO foundations; there are no extra
AI-specific requirements or guarantees. No documented requirement for `llms.txt`
was established, so none is added. Clear original content, accurate sources,
crawlable links and honest structured data are the implemented foundation.

## Local checks

Use the existing unconfigured local development server on port 3001, or set
`PLAYWRIGHT_BASE_URL` to an equivalent instance. The HTTP/browser tests deliberately
expect empty `SITE_URL` and indexing disabled. Pure policy tests exercise enabled
production configuration without contacting the synthetic domain fixture.

```powershell
npx eslint src\modules\seo src\proxy.ts src\app\robots.ts src\app\sitemap.ts src\app\layout.tsx src\app\page.tsx src\app\appeal\page.tsx src\app\auth\sign-in\page.tsx src\lib\env.ts tests\seo.spec.ts
npx playwright test seo.spec.ts appeal.spec.ts
npx tsc --noEmit --incremental false
```

Coverage includes missing/invalid configuration, preview guards, public canonical
and OG metadata, sitemap scope, search/training crawler split, private route and
alternate-host rules, actual default HTTP headers/robots/sitemap, and JavaScript-
disabled public/private HTML. Appeal tests also preserve phone layout checks.

Verification results: focused ESLint passed; all 18 SEO/appeal Playwright tests
passed against the local server. A source TypeScript check using the repository
compiler options passed for 74 source roots with generated `.next` roots excluded.
The standard repository-wide TypeScript command remains blocked by the existing
`.next/dev/types/validator.ts:25` `/admin` versus `/` layout-route constraint
mismatch. Generated route files were not edited or cleared. A production build
and physical deployment were not verified in this step.

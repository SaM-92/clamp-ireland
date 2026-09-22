# Content-policy enforcement handoff

## Scope and deployment state

Repository-only implementation. No Azure resource, model, role, live database, paid-inference, commit or push operation is part of this work. Migration `supabase/migrations/0006_content_policy.sql` is **prepared, not applied**. Production writes require that migration and configured inference; absence fails closed rather than accepting unchecked text.

The gate blocks profanity, abuse, harassment, threats, impersonation and prompt-injection attempts. Factual, non-abusive criticism (including unclear signage, excessive fees, poor service and unfair treatment) is explicitly allowed. Deterministic checks are a cheap first filter, not a claim that every abusive spelling can be identified without contextual classification.

## Shared integration contracts

- Browser-safe `src/modules/content-policy/policy.ts`: `normalizeContent(text)` and `validateContent(kind, unknown)` return normalized text. Kinds are `"report_note"` and `"username"`. Validation throws `ContentPolicyError` with safe `code`, `status`, and `message`; it is **not an AI approval**.
- Server-only `checkContentPolicy({ kind, text })` in `server/check.ts` returns a frozen `ApprovedContent` `{ kind, text }`. `assertApprovedContent(value, kind)` checks issuance using a server-local WeakSet; JSON-shaped or copied approvals cannot enter the report/username repositories.
- The checker uses the parent's `requestStructuredOutput({ instructions, input, format, maxOutputTokens, timeoutMs })`. `format` is Responses API `{ type: "json_schema", name, strict: true, schema }`. The result must have exactly `allowed: boolean` and `code: "allowed" | "profanity" | "abuse" | "unsafe_username" | "prompt_injection"` with consistent values. No freeform model explanation is returned to users.
- `consumeContentPolicyAttempt(userId)` must run after confirmed authentication, profile eligibility and cheap validation, but before this checker in a production write route. It uses the mandatory service-only `consume_content_policy_attempt` RPC. The low-level checker does not authenticate on its own and must never be exposed as an unauthenticated production endpoint.
- Policy rejection is **422**, code `content_policy_rejected`, with a safe edit-before-continuing message. Provider errors, incomplete/malformed decisions or unconfigured checks are **503**, code `content_policy_unavailable`, with a retry message. Invalid input is **400** (`invalid_content`), exhausted capacity **429** (`content_policy_rate_limited`), incomplete onboarding **409** (`username_required`). Persistence failures do not falsely assert that no write occurred.

The parent owns local-preview integration and the dev-only AI demo. Use `validateContent("report_note", text)` for free deterministic preview checks. A contextual demo must call the same server checker through the parent's explicitly enabled, loopback-only development guard and independent demo budget, remain absent in production, and label results **demo**, not human approval or publication. Never serialize an `ApprovedContent` and later treat it as a production approval. No dev endpoint was added by this module. `ReportForm` performs browser validation, but only a server check is authoritative.

## Production paths and username onboarding

`POST /api/reports` verifies the confirmed Supabase account, bounds multipart input, validates location/type/date/photo, normalizes and cheaply validates the note, requires a checked public username, reserves capacity, runs AI, then uploads an image and inserts a report. Rejection/outage never uploads an image or inserts a report. The repository also requires the in-process approval, so callers cannot bypass the gate by passing raw text. The existing heuristic wording aid is retained; both it and the original field receive the checked, normalized text.

AI approval only admits a submission to the **pending** queue. It never sets `reviewed_at`, publishes a note, approves a photo, or changes risk scoring. Existing human moderation and private-photo approval paths remain intact. Admin accounts receive no exception when using the user-submission or username endpoints.

`GET /api/profile/username` returns only `{ username: string | null, needsOnboarding: boolean }` for the confirmed account. `PUT` accepts only `{ username }`, checks policy and saves through service-only `set_approved_username`. Names are unique lower-case ASCII pseudonyms, 3-24 letters/numbers/underscores, starting with a letter. A conflict returns `username_unavailable` (409). No auth email, OAuth full name or raw signup metadata is returned as a public identity.

`/auth/username` is a working private/noindex onboarding page reached after password sign-in or the Google callback. A strictly validated GET showing an approved username redirects straight home without a PUT or another classifier call. The account menu explicitly links to `/auth/username?edit=1`, which keeps the form open for deliberate changes; submitting the unchanged normalized name also avoids a PUT. Load and save requests (including token lookup and JSON parsing) have 10-second and 20-second deadlines, abort on unmount, validate exact response shapes before updating state, and never automatically retry a potentially completed save. Email signup still requires confirmation first. Google OAuth redirect configuration must eventually permit `/auth/username`; **no remote auth configuration was changed here**. Existing accounts retain their IDs, privileges and report ownership; unapproved legacy placeholders/names are cleared by the migration and shown as pending onboarding, not leaked or presumed approved.

The map's pre-existing location-creation call is separate from report submission; a previously created location may remain after a rejected report. No rejected report content or image is stored.

## Database protection and budget

Migration 0006 depends on the existing profiles/reports schema and supersedes the profile trigger and browser write permissions without changing existing admin moderation RPCs or grants needed by the service role:

- Revoke browser/public INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER privileges on profiles and reports, plus any pre-existing **column-level** INSERT/UPDATE/REFERENCES grants. This blocks direct Supabase writes even if a permissive RLS write policy remains.
- New users get an empty pending-onboarding profile regardless of signup/OAuth metadata. Missing profiles for pre-trigger accounts are backfilled without altering existing privileges. Updating auth metadata cannot approve a profile. A checked timestamp plus strict format and unique-name constraints define the approved identity.
- Only the trusted server's service-role credential can execute username save and capacity-reservation RPCs. The database cannot itself attest to an AI result; protecting that credential and the server approval boundary remains necessary.
- Atomic row-locked counters allow **10 AI attempts per confirmed, non-banned user per UTC hour**, shared across username/report writes, and **200 attempts globally per UTC day**, across all application instances. Reservations include failed model attempts, have no automatic retry, and store no submitted text. Counters keep one row per account plus one global row and reset in place. A missing/unavailable RPC produces 503, never a silent local fallback.
- Report input is limited to 2,000 characters both before and after normalization; usernames to 24. Multipart reads stop at 9 MiB, photos at 8 MiB, username JSON at 256 bytes. AI has a 192-token output limit and 15-second deadline, allowing headroom beyond the parent's observed 8.4-second synthetic clean-note call without adding retries. The parent client separately limits input/response bytes and uses minimal reasoning.

## Environment and packages

**No policy-specific environment variable or new package is required.** Do not introduce an optional enforcement switch. Parent-owned shared client configuration for the requested existing Azure deployment:

| Variable | Requirement |
| --- | --- |
| `AI_PROVIDER` | `azure` |
| `AZURE_OPENAI_ENDPOINT` | Existing resource HTTPS origin |
| `AZURE_OPENAI_DEPLOYMENT` | Exact existing small GPT-5-mini deployment name |
| `AZURE_OPENAI_AUTH_MODE` | `entra` (existing CLI/managed identity), or existing `api-key` mode |
| `AZURE_CLIENT_ID` | Optional, only if selecting an existing user-assigned managed identity |
| `AZURE_OPENAI_API_KEY` | Only for existing API-key mode; server-only |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only credential |

The shared client may support `OPENAI_API_KEY` for its separate OpenAI mode; this policy does not select that provider or create a fallback. Parent owns `.env.example`, `src/lib/env.ts`, package manifests and the `@azure/identity` dependency. `ENABLE_LOCAL_AI_DEMO` belongs to the parent's guarded demo, not production enforcement.

No package script change is required. Optional parent-owned script:

```json
"test:content-policy": "playwright test --config tests/content-policy.config.ts"
```

Direct Windows command (no application server, no browser, no model network):

```powershell
npx playwright test --config tests\content-policy.config.ts --reporter=line
```

## Verification and remaining limits

Scoped Playwright tests use the repository's TypeScript VM-loader pattern with a fake provider and in-memory PGlite. They cover clean criticism, normalization/obfuscation, disallowed abuse, benign substring false positives, unsafe usernames, prompt injection, provider outage/malformed output, unconfirmed access, quotas, no-write/no-upload rejection, forged server approvals, legacy onboarding, metadata injection, direct browser table/column/RPC bypass and retained human moderation writes.

The focused onboarding follow-up has eight mocked runtime regressions covering automatic approved-user redirects, pending setup, explicit edits, unchanged-name no-op saves, strict response parsing, whole-operation load/save deadlines, unmount cancellation and the edit link. Run without a server or model call: `npx playwright test --config playwright.unit.config.ts username-onboarding-runtime --reporter=line`.

The parent reports a separately approved Azure synthetic smoke: summary generation in 5 seconds, factual criticism allowed in 8.4 seconds, personal abuse blocked in 3.9 seconds, and an unsafe username rejected locally without inference (three paid calls total). This policy agent's tests remain entirely mocked; these few live examples are not a systematic model-quality evaluation. Real Supabase schema application, OAuth redirect configuration and end-to-end browser/auth integration remain unexercised. Human review remains essential; contextual classifiers can make mistakes. A failed database write after a successful image upload can leave private staged evidence, as in the existing storage lifecycle; rejection itself never uploads.

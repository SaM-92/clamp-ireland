# Area summaries: implementation and handoff

Status: Steps 1 and 2 implemented. Generation is an explicit admin action,
followed by a separate human approval. **Update:** the shared Azure transport
and synthetic live demonstration are documented in handoff 17. The original
implementation described below made **no live model requests
or paid calls**, deployed no migration and changed no credentials or dependencies.
Migration `0004_reviewed_area_summaries.sql` depends on `0001` and `0002`, not the
separately owned `0003` analytics migration. Parent owns final production build,
deployment. Shared administration navigation now includes Area summaries.

## Setup and manual workflow

1. Apply `0004_reviewed_area_summaries.sql`, then the forward migration
   `0007_concise_area_summaries.sql`, through the approved
   Supabase migration process. It includes the Step 2 edited-approval RPC and
   generation admission table/functions. This work did not apply Step 1 SQL
   to a live database. If it was independently applied elsewhere, prepare a
   reviewed forward migration rather than rerunning the non-idempotent file.
   Migration 0007 switches generation/cache/public reads to `area-summary-v2`.
   Existing v1 drafts/approvals become stale without rewriting or deleting
   historical text; generating and separately reviewing a v2 draft is required.
   Neither migration has been applied to a live database in this session.
2. Configure the existing central environment variables:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, a server-only AI provider (Azure GPT-5 mini
   with Entra or explicit API-key authentication, or the original OpenAI
   provider), and
   `ENABLE_AREA_SUMMARIES=true`. Never put either privileged key in a
   `NEXT_PUBLIC_*` variable, URL, browser storage or client request.
3. Sign in with an existing administrator account (`profiles.is_admin`).
   Open `/admin/summaries`, choose a location from the existing public
   `/api/locations` response, and inspect its complete 500m source count/bytes.
   Coordinates and report counts label choices; no raw UUID entry is required.
4. Click **Generate draft (may incur cost)**. A current matching draft is
   reused before any provider request. **Regenerate draft (paid request)**
   explicitly requests another model draft; it never overwrites an approval.
   Counts beyond the limits disable generation with an explicit explanation.
5. Read **all source notes**, edit the short sentence if needed, and check the
   confirmation for that exact wording. Any edit clears the checkbox.
   **Approve & publish summary** atomically checks source freshness, stores
   the edited sentence and records the authenticated admin's approval.
   **Reject draft** leaves any previous still-fresh approval alone.
6. Open location notes on the map. The compact **Nearby summary**
   section only reads a fresh human-approved summary; opening it never
   triggers a model request. Browser-local preview explicitly requires a real
   backend and never requests summaries, even for UUID-shaped local IDs.

Disabled or missing server configuration is an explicit state, not demo data
or an empty-but-successful generation. API auth failures clear private state;
sign-out/auth changes abort pending browser requests and clear drafts, edits,
source notes and selected-location state. The page shell/setup instructions
are public, like the existing moderation page; all workspace data and actions
require the real server-side admin gate. There is no auth bypass.

## Routes and parent navigation integration

| Route | Contract |
| --- | --- |
| `/admin/summaries` | Mobile review workspace, linked from shared AdminNav |
| `GET /api/admin/area-summaries` | Admin-only setup state; add `?locationId=<uuid>` for current count, safe approved source context, draft and current published summary |
| `POST /api/admin/area-summaries` | Admin-only `{locationId, regenerate: boolean}`; feature/key checks, full-set validation and admission control before generation |
| `PATCH /api/admin/area-summaries/[id]` | Admin-only `{action:"approve", sentence, sourceFingerprint, reviewed:true}` or `{action:"reject"}`; reviewer comes from auth, never the request body |
| `GET /api/locations/[id]/summary` | Public, no inference; `available` with safe display fields, or `none` / `disabled` / `unconfigured`; explicit error status on read failure |

Admin requests use the existing `getAccessToken` Bearer-token handling.
Private responses use `Cache-Control: private, no-store` and
`Vary: Authorization`; public responses and errors use `Cache-Control: no-store`.
The public HTTP summary contains **only sentence, sourceCount, radiusMetres,
generatedAt and reviewedAt**. It exposes no source notes, fingerprint, IDs,
coordinates, reviewer identity, model key, photos or private provenance.

The separate admin app navigation links Overview, Moderation queue and Area
summaries. All pages and APIs use the two-account gate; see handoff 14.

## Meaning and sources

One summary covers **all human-approved, published, nonremoved reports whose
stored location is within an inclusive 500 METRE RADIUS of the selected spot**.
The spot is an exact latitude/longitude, not a rounded tile, a nearest-location
lookup or a transitive cluster. Overlapping neighbourhoods can share reports.
Reports use `locations.geom`, the location representation available in `0001`;
we do not invent an original report coordinate. No existing 100m map circles,
location grouping, risk scores or counts are changed.

The authoritative predicate in `area_summary_sources` is:

```sql
from public.reports r
join public.locations l on l.id = r.location_id
where r.moderation_status = 'published'
  and r.reviewed_at is not null
  and not r.is_removed
  and ST_DWithin(
    l.geom,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    500,
    true
  )
order by r.id
```

PostGIS geography uses metres on the WGS84 spheroid; this is not planar degrees.
The recorded human-review marker is `reviewed_at`, consistently with `0002`.
`reviewed_by` may be null after profile deletion; it is not a model input.
Only approved `description` is used, never `description_raw`, user identity,
reviewer identity, reporter type, incident date or photos. Empty approved notes
remain in membership/count/fingerprint and in the model input as empty text;
they do not establish an incident or a requirement. All-empty sets are refused.
Future note-edit flows must preserve the existing human-review publication policy.

## Contract and hard limits

| Item | Limit / behavior |
| --- | --- |
| Model | `gpt-5-mini` only |
| Contract/cache version | `area-summary-v2` |
| Radius | Exactly 500m, not caller-configurable |
| Approved sources | At most 200; 201 refuses the entire set |
| Approved description bytes | At most 48,000 UTF-8 bytes total; no per-note truncation |
| Instructions + serialized input | At most 96,000 UTF-8 bytes, including JSON escaping |
| Output | Strict object with only `sentence`, starting `Reports mention `, one sentence, at most 20 words AND 160 characters; prompt targets 8-12 words |
| Provider output budget | 1,024 tokens, including reasoning; `reasoning.effort="minimal"` |
| Provider deadline | 30 seconds; abort on timeout; no automatic retries or redirects |
| Provider JSON response | At most 65,536 bytes; malformed/oversized JSON is an error |
| Admin request JSON | At most 4,096 bytes |
| Generation admission | Cross-process lease per exact centre, 90-second in-flight expiry and one-minute minimum cooldown |
| Publication | Draft until a human admin approves this exact stored sentence |

These are processing/call caps, **not a fixed monetary price or an account-wide
budget**. Set project billing limits/alerts with the provider. Different centres
(including overlapping neighbourhoods) can each incur a charge. A timeout or
network interruption does not prove that OpenAI cancelled or waived a charge.
Input bytes count UTF-8 trusted instructions plus serialized note data before
the enclosing HTTP JSON envelope; bytes are not a token estimate.

Zod and the SQL sentence constraint reject extra output fields, multiple
sentences, line breaks, markup and obvious contact links. The sentence rule is
deliberately restrictive (no internal `.`, `!`, `?`, including abbreviations or
decimal points). The TypeScript 160-character limit counts UTF-16 code units;
the SQL limit counts PostgreSQL characters, so application validation can be
stricter for non-BMP text, never looser. Word counts use whitespace-delimited
words, including the `Reports mention` prefix. Generation, admin editing,
approval, demo display and public parsing enforce the limits; SQL migration
0007 also checks new v2 writes and edited approvals. Oversized output fails
explicitly: it is not truncated, silently replaced or automatically retried.

These checks **do not prove grounding or anonymity**. The instructions require
cautious attribution, no allegations converted to facts, no inferred
requirements, no invented consensus, no identities, and refusal when a safe
grounded sentence is impossible. A moderator must still check every assertion
against the source set and reject identifying, unsupported or misleading text.
Example: "Reports mention visitor parking that requires registration through a
residents' app." Use that wording only if the source notes actually support it.

`buildAreaSummaryInput` validates completeness and UTF-8 size, sorts by report
UUID, and passes all note text as JSON **untrusted data** in a separate input
from the trusted instructions. Database/report identifiers and provenance do
not enter that input. Prompt injection in notes is never authority. OpenAI
structured output constrains object shape; local Zod validation must also run.
Provider refusals/partial responses must be errors, not publishable placeholders.

`server/provider.ts` uses the shared `ai/server/client.ts` for one server-only
POST to the configured Azure resource's `/openai/v1/responses` endpoint, or
`https://api.openai.com/v1/responses` in explicit OpenAI mode, using GPT-5 mini,
`instructions`, JSON notes as `input`, `text.format` strict JSON schema,
`max_output_tokens: 1024`, `store: false` and `stream: false`. It uses no tools,
images, conversation state or provider response cache. The model gets note
descriptions and ordinal numbers only, not coordinates, source IDs, dates or
identity/photo fields. Human source review remains essential: an approved
description must itself have identifying details removed before sending it.
The prompt is defense in depth, not an anonymizer.

Responses are parsed from completed assistant `output[].content[].output_text`,
not an SDK-only `output_text` convenience field. Refusal, incomplete output,
provider failure, malformed JSON/schema, 429, HTTP/network errors and timeout
have explicit safe errors. No request/response body, key, raw note or arbitrary
exception is logged; routes log fixed error codes only. No heuristic fallback
or partial summary is saved. Failed regeneration does not delete the prior
approved row. Source changes independently invalidate it as required.

API shape references checked during implementation:
[Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create)
and [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
Reading documentation did not invoke a model. `store:false` is not a claim of
provider-wide zero data retention; deployment operators must review the
provider's current data-processing terms.

## Storage, freshness and permissions

- `get_area_summary_sources(lat,lng)` returns one JSON snapshot containing the
  entire source array, count, byte count, fingerprint and date range. Returning
  an aggregate avoids Supabase's normal row-page limits. Oversized/no-text sets
  raise explicit errors, not partial arrays or success-shaped fallback text.
- The SHA-256 source fingerprint includes exact centre, radius, every source's
  UUID, location UUID/coordinate, approved description, created time and review
  time. Per-row hashes are concatenated in UUID order, with UTC timestamp
  serialization. Private originals/photos/reviewer identities do not affect it.
- Cache identity is `(latitude, longitude, source_fingerprint, model,
  contract_version)`. `create_area_summary_draft` checks the current snapshot
  and reuses a matching draft/approval without overwriting its wording. It
  never revives a rejected/stale row. The orchestration reuses a matching
  **draft** before spending, and passes `p_regenerate=true` when saving actual
  model output so it always creates a new draft, not an approval. Generation
  admission RPCs serialize/cool down requests across server processes.
- Report membership/text/review-time changes mark affected drafts/approvals
  permanently `stale`, including deletion, rejection, removal and publication
  of additional notes. Location movement/deletion covers both old/new
  neighbourhoods. Restoring old text/membership does not revive an old approval.
- `review_area_summary` requires a nonbanned admin profile, an existing draft,
  and a current matching fingerprint for approval. Review records a timestamp
  and reviewer privately. The service caller must derive that reviewer from
  authenticated `requireAdmin`, never a request-body UUID. These database
  checks cannot prove a human clicked a button; the separate PATCH route
  requires an explicit `reviewed:true` assertion and uses `requireAdmin`.
  `approve_area_summary_draft` locks the draft, checks the submitted fingerprint
  and atomically edits/approves through the same review guard. A rejected or
  stale approval rolls back the text edit. Approved rows cannot be edited.
- `get_public_area_summary` recomputes the source fingerprint **on every read**
  and returns only a current approved summary, or SQL/JSON null. This is the
  safety gate even if an invalidation is missed or generation races a source
  change. It follows normal PostgreSQL statement-snapshot visibility, not a
  claim that already-rendered client text can be retroactively withdrawn.
- Database RPC public projection: ID, centre/radius, sentence, source count, oldest/newest
  source creation times, latest source-review time, generated/approved times,
  model and contract version. No source array, source fingerprint, raw text,
  user/reviewer IDs or photo fields. Provenance describes community notes,
  **not verified incidents**. The HTTP endpoint narrows this further to the
  five display fields listed above.
- RLS is enabled with no browser policies or table grants. Anon/authenticated
  can execute only the safe public summary RPC. Source helpers, snapshots,
  draft creation and review are service-only. Even `service_role` has no direct
  table write grant; it reads privately and writes through the narrow RPCs.
  PostgreSQL's default PUBLIC function execution is explicitly revoked.
  The lease table also has RLS and no direct client/service grants; only its
  service-only acquisition/release functions can operate on it.

The server-only repository validates inputs/outputs and propagates errors.
Only the anonymous Supabase client is used for public reads; there is no
service-role fallback. The public route does not import the generation service.

Public UI text is cleared at the start of every revalidation and on selection
changes, hidden tabs, failures or no-current-summary results. Reads revalidate
every 30 seconds while visible, on visibility changes and on same-browser
same-origin summary-review broadcasts; each read has a 10-second timeout.
The separate admin origin cannot broadcast to the public origin, so public
freshness relies on polling/visibility and the server fingerprint gate. No summary is
persisted to local storage. This prevents indefinite stale display, not
instantaneous cross-user push invalidation: a note moderation change can occur
between polls. Every database read uses current statement-snapshot visibility.

## Validation and files

Pure contracts and actual `0002`/`0004` SQL are tested with existing Playwright
and PGlite tooling. **PGlite PostGIS stubs are policy fixtures only**: fake
planar distances test filtering/boundaries/overlap without claiming WGS84
distance verification. A separate assertion pins the exact production PostGIS
expression. Tests cover roles, safe projection, review, stable fingerprints,
invalidation/restoration, independent read-time freshness, all-source limits,
empty text, untrusted prompt input and error propagation. Step 2 adds edited
approval rollback, generation leases/cooldown, cache reuse, stale saves,
provider fetch mocks (including all 200 source notes), feature/key gates,
real admin auth-gate rejection and safe public route projection.

The browser suite checks the real `/admin/summaries` workspace at 375px with
mock API responses, safe source rendering, checkbox reset, failed regeneration,
stale approval, access-loss clearing and backend guidance. The real public
React component and CSS are bundled into an isolated browser harness using
already-installed Next/TypeScript tooling, exercising fresh/empty/error/malformed
responses without changing deployment configuration or contacting a backend.
The existing local-preview notes dialog is also exercised.

Owned implementation files:

- `src/modules/area-summaries/types.ts`
- `src/modules/area-summaries/contract.ts`
- `src/modules/area-summaries/server/{config,errors,http,provider,repository,service}.ts`
- `src/lib/server/readBoundedJson.ts`
- `src/modules/area-summaries/components/{AdminSummaryWorkspace,NearbySummary}.tsx`
- `src/modules/area-summaries/components/AreaSummaries.module.css`
- `apps/admin/src/app/admin/summaries/page.tsx`
- `apps/admin/src/app/api/admin/area-summaries/route.ts`
- `apps/admin/src/app/api/admin/area-summaries/[id]/route.ts`
- `src/app/api/locations/[id]/summary/route.ts`
- `src/modules/reports/components/LocationNotes.tsx`
- `supabase/migrations/0004_reviewed_area_summaries.sql`
- `tests/area-summary-{contract,policy,server,runtime,browser}.spec.ts`
- `docs/11-area-summaries-handoff.md`

Run `npx playwright test area-summary --reporter=line` (filename pattern,
not Windows path separators, because Playwright arguments are regexes).
Browser tests require the existing app server (default `http://localhost:3001`;
override `PLAYWRIGHT_BASE_URL`). Use `PLAYWRIGHT_PRODUCTION=true` when running
the parent's final production suite to skip the development-only preview test.
Provider tests always replace fetch; even a machine with real keys makes no
model calls through this suite. Full TypeScript and scoped ESLint pass; parent
reported the earlier generated-route errors resolved.
The final combined run passed 33 tests (32 area-summary tests plus the existing
public-note policy regression); the separate existing 100m/50%-opacity zone
regression also passed.

The public read setup now requires only its opt-in flag and anonymous backend
configuration, not generation credentials. `OPENAI_API_KEY` belongs only to
the separate admin runtime. Admin generation retains all original key, resource
and review gates.

**Not claimed:** live provider inference/quality, real PostGIS geodesic boundary
execution or deployed migrations. Once backend work is approved, exercise real
499m/500m/501m and overlap fixtures before release. Live model quality/cost checks
and deployment require separate approval. Handoff 14 records the later split
and independent production-build verification.

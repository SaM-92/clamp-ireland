# Private deployment and photo-processing handoff

## Current state

No Azure application, resource group, storage account, role assignment or live
database migration was deployed in this phase. No container image was published.
The supplied Visual Studio subscription is development/testing only; its
spending limit was not changed.

The owner initially approved North Europe, `rg-clamp-ireland-dev`, Supabase Free
outside Azure and a EUR 10/month low-traffic target. They subsequently required
**every application endpoint, including direct Blob and Supabase access, to be
restricted to approved public IPs**. That requirement supersedes the earlier
public-endpoint architecture.

The owner clarified that no current-IP snapshot should be saved. The temporary
snapshot was removed; supply approved host IPs privately at deployment time.
Restrictions must be applied during provisioning, before access is enabled,
not added after an open deployment. A different network/VPN/mobile connection
is not automatically approved. An IP allowlist identifies a network exit, not
a particular person; authentication and the two-account admin gate remain necessary.

## Hard deployment hold

Supabase's documented network restrictions cover Postgres and its pooler, **not
HTTPS Auth, PostgREST or Storage**:
https://supabase.com/docs/guides/platform/network-restrictions .
Locking only the websites would leave a direct backend path. Do not describe
closed registration or RLS as network isolation.

`scripts/release/network-policy.mjs` deliberately blocks actual cloud deployment.
The manual workflow checks it before a deployment can be queued, and the
preflight and real Azure transport check it independently. Packaging alone is
not deployment. Removing this hold requires an implemented, reviewed private
backend/network design and verified inside/outside access behavior, not another
boolean environment variable.

The prepared Bicep now requires a non-empty secure host-IP configuration, puts
Allow-only `/32` restrictions on both apps, and sets Blob firewall default Deny
with no trusted-service bypass. It is **not deployment-ready**: Container Apps
still need an approved private path to Blob, and the hosted Supabase backend
does not meet the requirement. Do not open the firewall to Azure's dynamic
outbound IPs or to the internet to make uploads work.

Do not change networking on the existing shared AI resource as a workaround:
it serves another project. Reassess its suitability or use a separately approved
private inference design. Reassess cost before adding a database VM, private
endpoints, NAT or other fixed-cost infrastructure.

Deployment promotion is configured for a `self-hosted, Linux, clamp-private`
runner on an approved connection. Such a runner has **not** been installed.
Do not temporarily allow GitHub-hosted runner IPs. Protected reviewers,
prevent-self-review, OIDC and explicit environment opt-in remain required.
`APPROVED_CLIENT_IPV4S` is a private JSON-array environment secret; promotion
compares both applications' actual ingress rules with those exact hosts.
Real addresses never enter deployment records.

## Photo pipeline

- `src/modules/photos/policy.ts` owns shared limits and file-picker guidance:
  one JPEG/PNG/WebP/HEIC/HEIF, maximum 50 MiB and 64,000,000 decoded pixels.
  RAW/DNG and animated/multi-image inputs are excluded.
- `normalize-worker.mjs` uses Sharp plus `heic-decode`/`libheif-js` WASM.
  Sharp alone does not provide HEVC decoding in its ordinary prebuilt package.
  Format signatures, decoded dimensions and frame count are checked. Orientation
  is applied; metadata is omitted; output is WebP at most 3 MiB. A bounded
  quality/dimension sequence ends at 2048 pixels when needed, rather than storing
  an oversized output.
- Processing uses a disposable worker, a 30-second deadline, one active
  normalizer per process, disabled Sharp caching and one Sharp execution thread.
  A worker's V8 heap limit does not bound WASM/native buffers; container memory
  remains essential.
- Report admission serializes report bodies per process before buffering.
  Multipart reads allow 51 MiB total, enforce actual streamed bytes, and time
  out after 120 seconds. Auth/admission, inference, Blob and report persistence
  also have bounded operations. Busy submissions return 429, not a silent queue.
- `src/proxy.ts` excludes the upload route: Next's proxy otherwise clones and
  truncates bodies at its default 10 MB. The route sets its own private/no-store
  and noindex headers. Do not merely increase global proxy buffering.
- Policy approval still precedes normalization, upload and pending report
  insertion. The route passes processed bytes to the Blob adapter. The admin
  signer no longer imports the upload worker, preserving independent builds.

The Blob adapter uses managed identity in deployed environments and explicit
Azure CLI credentials only for local development. There is no storage-key or
Supabase Storage fallback. Names contain generated identifiers, never the
original filename; uploads cannot overwrite an existing blob.

Moderator URLs verify blob existence and grant only HTTPS read access for at
most ten minutes. Authorization still belongs to the calling admin endpoints.
Photos remain private after report approval; there is no public-photo publisher.

Explicit SQL rollback errors permit deleting newly uploaded evidence.
Transport/unknown persistence failures can follow a successful commit, so those
photos are retained with a reconciliation error instead of risking destruction
of a saved report. Ambiguous uploads and failed cleanup also need operator
reconciliation; an automatic orphan-reconciliation job is not implemented.
The prepared storage account has seven-day soft deletion and no versioning,
so deletion is not immediate permanent erasure.

## Resource sizing and local evidence

Both application builds and standalone worker checks passed. Local Linux images
were built and run without network access or published ports. Under a public-app
limit of **1 vCPU / 2 GiB**, the real 64-MP HEIC fixture normalized successfully;
the decoder process reached approximately **1283 MiB peak RSS**. A 1-GiB public
container would not safely meet that measured case. The admin target uses
0.25 vCPU / 0.5 GiB. Both templates scale from zero to one replica.

The real standalone HTTP route accepted a 50-MiB source through validation and
reached a synthetic quota denial; one extra source byte was rejected before
inference/storage. This verifies the framework upload boundary without a paid
model call or a real write. It does not prove the future Azure ingress path.
Actual Blob permissions, cloud authentication and outside-IP denial are untested
because no environment exists.

Unit coverage includes ordinary formats, orientation/metadata removal, actual
small and 64-MP HEIC, over-limit pixels, corrupt/TIFF/animated content, incompressible
images, byte boundaries, serialization, cleanup and short-lived signing.
Fixtures are original generated shapes; Python is optional for regeneration,
not a runtime/CI requirement. See `THIRD_PARTY_NOTICES.md` for codec licensing.

Use `npm run test:unit`, `npm run test:release` and `npm run test:infra`.
The last command compiles Bicep and checks the resulting resource contracts;
it performs no deployment. The full local build is `npm run build:all`.
`scripts/release/container-smoke.mjs` exercises isolated Linux runtimes and
copies synthetic test helpers into temporary containers only, never release images.

## Remaining work before any cloud deployment

1. Agree and implement a backend/private-connectivity design satisfying the
   all-endpoint restriction within an explicitly reviewed budget.
2. Set up the real backend and two genuinely confirmed tester accounts, apply
   migrations 0001-0007 to the approved project, and close provider-side signup.
   The owner deferred backend configuration; no credentials were supplied.
3. Keep app registration closed. `NEXT_PUBLIC_REGISTRATION_ENABLED` defaults
   false and is compiled false by the current release workflow; changing only
   runtime environment variables does not change browser bundles.
4. Confirm budget billing currency and recipient privately. Budget alerts notify;
   they do not stop spending. The resource-group budget excludes shared AI and
   external services; scale-to-zero grants are shared across the subscription.
5. Recheck regional Consumption compute availability and applicable policies.
   Direct provider reads reported 0/50 environments and 0/250 storage accounts;
   those counts do not establish compute capacity. `Microsoft.Quota` was not
   registered, so its empty/failed result must not be treated as available quota.
6. Complete Azure validation/what-if, then authorized deployment. Verify access
   from an approved connection and rejection from a genuinely different IP,
   including direct backend/blob URLs and authenticated requests.
7. Publish a new matching source version/tag and immutable image records when
   appropriate. The existing `v0.1.0` tag is an older baseline and must not move.

# Deployment plan

Status: **Container Apps / SQL free-offer feasibility checked; application migration and full deployment preparation still outstanding**.

## Deployment request - 2026-09-23

### Hosting correction - owner decision

The owner approved replacing SQLite with Azure SQL Database's free offer,
conditional on eligibility and budget checks. This is the active candidate:
two Azure Container Apps on Consumption, scale-to-zero, one free-offer SQL
database with paid overage disabled, private Blob and Google-only sign-in.
The read-only SQL preflight passed and the low-traffic estimate below fits the
target under its stated assumptions. This is not a deployed or fully validated
application. No VM, paid database fallback or spending-limit change.

The owner explicitly requires Azure Container Apps as previously agreed and
rejects VMs. No VM may be provisioned or treated as the selected architecture.
The VM analysis below is rejected decision history only.

Resume the Consumption/scale-to-zero design and original EUR 10/month target.
The current two-app embedded SQLite WAL implementation requires persistent
local-disk storage, which ordinary Container Apps replica storage does not
provide. Do not deploy it on ephemeral disk, copy a live file to Blob as if
that guarantees durability, or share WAL over Azure Files/SMB/NFS.

Research a compatible, low-cost durable data option. A database-engine change
requires an explicit explanation and owner approval before implementation;
Container Apps approval does not revoke the prior SQLite choice automatically.
Keep Google sign-in, private Blob, separate admin authorization, fail-closed
IP restrictions and the development-only subscription unchanged.
Do not repeat an unverified EUR 10/month guarantee.

Verified compatibility findings:
- Microsoft documents that Container Apps container/replica files disappear
  on container/replica termination; its persistent mounts are Azure Files.
- SQLite documents that WAL cannot be shared across hosts over a network
  filesystem. The current public/admin database therefore cannot be shipped
  unchanged on that mount.
- A candidate is Azure SQL Database's free offer instead of embedded SQLite,
  not in addition to it: 100,000 vCore-seconds, 32 GB data and 32 GB backup
  per database per month. Configure "Auto-pause until next month", never paid
  overage. Exhausting the allowance makes database-backed features unavailable
  until reset, and serverless resume can add latency.
- Subscription-specific free-offer capabilities and read-only ARM validation
  passed in Sweden Central. The cost estimate below does not deduct any shared
  subscription grants. No overall EUR 10 spending cap has been established.
- The owner's conditional migration approval can now proceed using this
  architecture and the documented low-traffic assumptions. Actual deployed
  free-offer properties must still be verified; never substitute a paid SKU
  or enable overage if allocation or deployment fails.

Sources:
https://learn.microsoft.com/azure/container-apps/storage-mounts
https://www.sqlite.org/wal.html
https://learn.microsoft.com/azure/azure-sql/database/free-offer?view=azuresql

### Conditional-approval checks - results

No application rewrite or provisioning has started.

- Microsoft.Sql is registered and this subscription currently lists no SQL
  logical servers. Microsoft's free-offer documentation includes this
  subscription type. Subscription-specific capabilities expose
  `supportedFreeLimitExhaustionBehaviors` with `AutoPause` as the default for
  the small serverless SKUs. Read-only subscription ARM validation of the
  preflight template returned `Succeeded` with no error. No resources were
  provisioned; verify the actual free-offer flags again after deployment.
- Subscription-specific SQL capabilities report **Visible / provisioning
  restricted** for North Europe and West Europe, including GP_S_Gen5_1 and
  GP_S_Gen5_2. Sweden Central reports **Available** for those serverless SKUs.
  The owner approved keeping apps in North Europe and placing SQL/Blob in
  Sweden Central. This also avoids Storage's same-region public-IP firewall
  limitation. Verify actual traffic in the deployed network before accepting it.
- Two unrelated Container Apps environments already exist in the subscription.
  Monthly grants are shared; do not assume this project gets a fresh grant.
- Retail USD active rates are 0.000024/vCPU-second and 0.000003/GiB-second,
  requests USD 0.40/million, in North Europe and Sweden Central. The EUR retail
  response rounded sub-cent per-second rates to zero; those are not free usage.
  At 30 active hours per app per month (public 1 vCPU/2 GiB, admin 0.25/0.5),
  compute is USD 4.05 before any grant, tax or currency conversion. At 100,000
  external requests, request charges before grants are USD 0.04.
- Sweden Central StorageV2 flat Hot LRS is USD 0.0184/GB-month, writes/list
  USD 0.05/10,000, reads USD 0.004/10,000. The complete scenario below also
  includes inference, logging, transfer and an illustrative tax allowance.
- An external custom-VNet workload-profile environment adds a billed load
  balancer plus ingress/egress static public IPs. Private endpoints, NAT,
  dedicated profiles and planned maintenance can introduce more fixed costs.
  Do not add these to a low-cost plan without pricing and approval.
- A default-network Consumption environment avoids those custom-VNet resources,
  but outbound IPs are not guaranteed to remain unchanged. Read-only inspection
  confirmed existing apps report outbound lists of different sizes (161 and 1);
  these are not proof of future exclusive/static egress for this new project.
- A candidate low-cost network arrangement uses only exact reported app egress
  IPs plus approved operator IPs on backend firewalls, with no AllowAzureServices
  wildcard, identity authentication still required, and default Deny. IP drift
  must fail closed and may cause outages until a reviewed allowlist update.
  The owner approved this operational tradeoff, including blocked connections
  until allowlists are updated. Do not claim static/exclusive egress. Never grant
  application identities permission to rewrite their own network restrictions.
- Alternatively, relaxing backend IP restrictions while keeping website ingress
  IP-restricted changes the owner's earlier all-endpoint requirement and is not
  authorized. Do not make that change implicitly.

Additional sources:
https://learn.microsoft.com/azure/container-apps/billing
https://learn.microsoft.com/azure/container-apps/custom-virtual-networks#managed-resources
https://github.com/microsoft/azure-container-apps/issues/801
https://learn.microsoft.com/azure/azure-sql/database/network-access-controls-overview

### Low-traffic monthly estimate - not a spending cap

Retail rates checked 2026-09-23. No Container Apps, logging or bandwidth free
grants are deducted, because other projects share this subscription. The
subscription's development credit is also not deducted. SQL is zero only with
the validated free-offer settings; it pauses at exhaustion, rather than billing.

| Component | Monthly usage assumption | Approximate EUR before tax |
| --- | --- | --- |
| Public/admin Container Apps | 30 running hours EACH; 1 vCPU/2 GiB and 0.25 vCPU/0.5 GiB | 3.48 |
| HTTP requests | 100,000 requests | 0.03 |
| Private Hot LRS Blob | 5 GB, 10,000 write/list and 100,000 read operations | 0.16 |
| Log Analytics | 0.25 GB ingestion, included retention only | 0.59 |
| Inter-region transfer | 20 GB billed transfer | 0.34 |
| Internet transfer | 5 GB at the first paid tier, no free grant assumed | 0.37 |
| GPT-5 mini Global Standard | 500 total calls; 2,000 input tokens average and 1,024 output tokens per call | 1.09 |
| SQL free offer | 32 GiB limit, local seven-day backups, pause at free-limit exhaustion | 0.00 |
| **Estimated total** | | **6.07** |
| **With illustrative 23% tax** | Actual invoice tax/currency treatment may differ | **7.47** |

The Container Apps USD rates were converted at 0.858664 EUR/USD, derived from
the same retail catalog's paired USD 2 / EUR 1.717328 GPT-5 mini output meter;
sub-cent EUR compute rates are rounded to zero by that API. Blob uses the same
conversion. Logs, bandwidth and inference use directly returned EUR rates.
This is an estimate, not an exact EUR compute quote or exchange-rate guarantee.

The running-hours assumption includes startup/cooldown time, not only request
processing. Idle charges are conservatively priced as active in this scenario.
Keep both apps at min 0 / max 1, single active revision, and avoid uptime pings
that keep them awake. SQL connections must close when idle; open pools/tools
can consume the free allowance and prevent normal auto-pause.

Model meter names are `GPT 5 Mini Inpt Glbl 1M Tokens` (EUR 0.214666) and
`GPT 5 Mini outpt Glbl 1M Tokens` (EUR 1.717328), service `Foundry Models`,
product `Azure OpenAI GPT5`. Do not use batch, cached-input, provisioned or
priority-processing meters. Sweden Central GlobalStandard model quota is
1000/3000 units allocated; this is capacity, not a usage budget. A separate
pay-per-token inference account with exact IP restrictions is required unless
another arrangement is explicitly approved. Leave the existing shared account
and its networking untouched; no inference calls were made during these checks.

No paid registry, NAT, private endpoint, custom VNet, external load balancer,
dedicated compute profile or additional DNS service is included. Use the
existing release/GHCR arrangement and provider HTTPS names initially.
Blacknight domain registration/renewal is separate from this Azure estimate.
More running hours, larger prompts, more requests/photos, retained versions or
logs increase the bill. Budget alerts do not enforce a EUR 10 cap. Existing
AI hourly/daily quotas likewise do not enforce a monthly monetary cap.

Container Apps regional usage reports 0/50 managed environments in North Europe.
The central Microsoft.Quota provider is unregistered, so its CLI query fails;
the Microsoft.App regional usages endpoint supplied that result. Do not
register providers or request quota increases implicitly.

The owner requested proceeding with app deployment while `clamptracker.ie`
registration at Blacknight is pending. Use that intended domain rather than the
earlier naming suggestions. Domain ownership, DNS activation and certificates
are not yet verified. Do not change nameservers or assume the domain resolves.

The existing SQLite source remains untouched while the conditional SQL checks
run. Read-only free-offer ARM validation uses `infra/preflight/main.bicep`;
this is not a full application deployment template or permission to deploy it.
It declares Entra-only SQL, no firewall exceptions, 32 GiB, local backups and
`useFreeLimit: true` / `freeLimitExhaustionBehavior: AutoPause`, with no paid
fallback. Private parameter values are supplied only to the validation process.
The earlier EUR 10/month target is not permission for a more expensive deployment.

Keep the development-only subscription scope and deployment-time approved-IP
requirement. No current-IP snapshot, secret, account identifier or OAuth
credential belongs in this plan. Do not change the shared AI resource's
network policy. Live Google configuration and administrator setup remain
separate prerequisites for authenticated user workflows.

- [x] Inspect current source, Azure context and existing project resources.
- [x] Confirm Container Apps, cross-region SQL/Blob and changing-IP allowlists.
- [x] Finish SQL free-offer and complete low-traffic cost checks.
- [ ] Migrate application storage only after the conditions pass.
- [x] Prepare Container Apps infrastructure and private deployment inputs
  (authored; live deployment not yet run).
- [ ] Run Azure validation, then approved deployment.
- [ ] Verify persistence, TLS, private access and inside/outside network denial.

### Rejected VM architecture and cost analysis (not an implementation plan)

Owner response: the EUR 35.44/month VM proposal is not approved. The earlier
low-cost commitment was not supported by a verified compatible hosting estimate.
Do not provision this candidate, treat subscription/region confirmation as
spending approval, or change the spending limit. Reassess an Azure design against
the original EUR 10/month target and explicitly distinguish always-on operation,
scheduled private testing, retail usage and remaining development credits.
No cloud resources have been created by this preparation.

Workspace mode: MODIFY. Recipe: standalone Bicep plus bounded Azure CLI
orchestration; retain existing Docker packaging and do not initialize an azd
template over the repository. The previous Container Apps templates remain
retired. No Copilot SDK or cross-cloud application migration is involved.

Candidate: one Ubuntu x86-64 VM in North Europe running both existing containers,
with 4 GiB RAM, a 32-GiB Standard SSD OS disk and a separate 32-GiB Standard SSD
data disk. Mount SQLite on that persistent data disk, never the VM temporary
disk; retain disks on VM deletion. Public app limit remains 2 GiB, admin
512 MiB, leaving room for the OS/proxy. Build images off-host. No second database
service, AKS, NAT gateway, paid registry or load balancer is needed.

Live EUR consumption retail prices checked 2026-09-23, assuming 730 hours/month:

| Item | Rate | Monthly estimate, before tax |
| --- | --- | --- |
| Standard_B2s Linux, 2 vCPU / 4 GiB | EUR 0.0386/hour | EUR 28.18 |
| OS disk, E4 LRS 32 GiB | EUR 2.0608/month | EUR 2.06 |
| Persistent data disk, E4 LRS 32 GiB | EUR 2.0608/month | EUR 2.06 |
| Standard regional static IPv4 | EUR 0.0043/hour | EUR 3.14 |
| Fixed base, excluding variable services | | **EUR 35.44/month** |

This excludes Blob/backup capacity and transactions, disk operations, inference,
outbound transfer, optional managed DNS/monitoring, tax and the Blacknight domain.
It is an estimate, not a cap. Azure credit may offset eligible development usage,
but remaining credit has not been checked. Do not disable the spending limit.
The earlier EUR 10/month target is not met by this always-on Azure VM option.

Alternatives considered: Standard_B2als_v2 is EUR 25.55/month for compute
alone, but Azure reports a location-wide NotAvailableForSubscription restriction
in North Europe. Standard_B2as_v2 (8 GiB) is EUR 51.17/month and also restricted.
Do not substitute either or change regions silently. B2s is older-generation
and burstable; sustained photo processing can exhaust CPU credits. Its returned
restrictions apply to zones 2/3, not the entire region. Prefer a regional
deployment; actual allocation is still subject to validation/capacity.
Do not use Spot or an under-sized 1/2-GiB host for the approved image limits.

Read-only provider evidence:
- Intended resource group does not exist; no app resources have been created.
- Regional and BS-family vCPU usage are each 0/20; this host requires 2.
- VNet usage 0/1000, public IPs 0/10, NSGs 0/5000, NICs 0/65536.
- The quota helper returned no rows because Microsoft.Quota is unregistered.
  Direct CLI exposed MissingRegistrationForResourceProvider; authoritative
  Compute `list-usage` provided the limits above. No provider was registered.
- Selected subscription remains Enabled, MSDN_2014-09-01, spending limit On:
  private development/testing only, not a public production launch.
- Google client ID, secret and invitation list are not configured locally.

### Access, persistence and staged readiness

- Inbound default Deny. Permit SSH/HTTPS only from privately supplied approved
  host IPs; no open HTTP, temporary CI allowlisting or world-accessible app ports.
  Containers bind to loopback behind a reverse proxy; the admin website remains
  separate. Store no current-IP snapshot or secrets in committed files.
- Standard LRS Blob account: anonymous/shared-key access disabled, firewall
  default Deny with trusted-service bypass disabled, explicit VM subnet service
  endpoint access and approved moderator IPs only. Managed identity and scoped
  RBAC protect processed evidence and a separate private backup container.
  Service endpoints restrict the service's public endpoint; they are not
  private endpoints. Direct SAS reads must still satisfy firewall rules.
- Daily SQLite online backup to private off-VM Blob, bounded retention, failure
  reporting and restore drill are required; copying a live WAL file is not backup.
  No backup scheduler exists yet. VM/disk/backup monitoring must be configured.
- Intended eventual origins: `https://clamptracker.ie` and
  `https://admin.clamptracker.ie`. Registration/DNS are pending. Keep Blacknight
  nameservers unchanged unless a separate DNS decision is approved.
- Private HTTPS requires DNS-01 certificate validation (or an approved existing
  certificate). Do not open HTTP/HTTPS to the world for ACME. DNS TXT/CNAME
  challenge setup/renewal awaits domain activation and registrar access.
  A VM's provider hostname alone does not give control over its DNS TXT records.
- While DNS/certificates are pending, private inspection can use SSH forwarding
  to loopback, not public HTTP or a pretend production HTTPS URL. Initial host
  provisioning is not a claim that login/reporting is usable.
- Do not change the shared AI resource's networking. Full all-backend isolation
  needs a dedicated network-restricted inference endpoint or another explicitly
  approved arrangement. Model quota, region, roles and variable prices remain
  to be checked. Leave classification unavailable rather than bypassing it.
- Google OAuth, invited accounts and exactly two administrators must be
  configured before authenticated workflows can be verified. Consent publishing
  and public production launch remain outside this private development scope.

Sources:
- https://prices.azure.com/api/retail/prices (EUR, North Europe, Consumption;
  VM product names exclude Cloud Services, Windows, Spot and Low Priority).
- https://learn.microsoft.com/azure/virtual-machines/sizes/general-purpose/bv1-series
- https://learn.microsoft.com/azure/virtual-machines/sizes/general-purpose/basv2-series
- https://learn.microsoft.com/azure/storage/common/storage-network-security-virtual-networks
- https://letsencrypt.org/docs/challenge-types/

## Approved simplification

The owner approved replacing Supabase/PostgreSQL with embedded SQLite and
Google-only sign-in. There is no separate database service, password login,
confirmation-email sender or custom authentication protocol. Use one SQLite
database on durable local storage, outside source control and container images,
with migrations and a verified backup/restore procedure.

Preserve the separate public/admin websites, two-account admin authorization,
checked pseudonyms, moderation, scoring, votes, private processed Blob photos
and bounded inference. Both app processes may use the same database only on
one persistent host/local filesystem; do not put SQLite on ephemeral Container
Apps storage or a shared network filesystem.

This authorizes application/container changes, not an unpriced hosting change
or cloud provisioning. Keep IP restrictions mandatory at deployment time.
Do not save a current-IP snapshot. Google credentials and the final persistent
hosting/network design still require configuration before live operation.

- [x] Implement the SQLite schema, transactions, geographic queries and backups.
- [x] Replace Supabase runtime repositories and Google authentication wiring.
- [x] Preserve public/admin boundaries and update tests against real SQLite.
- [x] Replace obsolete runtime/build configuration and document local operation.
- [x] Validate both apps, persistence, backups and isolated container behavior.

Local verification and empty-database initialization are recorded in handoff 19.
This does not validate cloud infrastructure, live Google consent, hosted storage
durability or inside/outside network access. The cloud deployment hold remains.

## Network-isolation requirement (supersedes the earlier network design)

The historical Supabase/Container Apps scope below is retained only as decision
history. The active backend is SQLite with Google OIDC; use handoff 19 and the
README. Templates moved to `infra/legacy-container-apps/` are retired, not ready
for deployment. Local preparation does not approve any replacement cloud host.

The owner requires restriction to their approved public IPs for **everything**:
both websites, direct Blob access, and direct Supabase access. Authentication,
closed registration and private containers alone do not satisfy this requirement.
The owner clarified that the current IP must not be saved now. The temporary
IP snapshot was removed. Supply the approved host IPs privately at deployment
time, and apply the allowlist as part of provisioning before any application or
backend becomes accessible. Never deploy openly and add restrictions afterward.

**Do not deploy the previously proposed Supabase Free hybrid architecture.**
Supabase documents that its network restrictions cover Postgres and its pooler,
not HTTPS Auth, PostgREST or Storage endpoints:
https://supabase.com/docs/guides/platform/network-restrictions .
Putting an allowlist only on the websites would leave a backend bypass.
A private-capable backend/network design and revised cost assessment are required.
Do not change the network policy of the existing shared AI resource, which serves
another project, as an implicit workaround.

The infrastructure below is preparation only. App ingress and Blob firewall rules
must fail closed, but app-to-Blob private connectivity and a network-isolated auth/
database backend are not implemented. Release deployment is hard-blocked in code.
The final access checks must originate both inside and outside the allowlist;
ordinary GitHub-hosted runners must not be temporarily whitelisted for promotion.
Deployment/smoke will require an approved-network runner or equivalent private path.
No Azure resources, network rules, roles or live database settings have been changed.

## Current deployment scope

Before the stricter network requirement, the owner approved proceeding after the Visual Studio credit restriction was
explained. This deployment is therefore a non-production version for the owner
and cofounder, not a public community launch. Public registration stays closed.
Use the privately confirmed subscription, North Europe, resource group
`rg-clamp-ireland-dev`, Supabase Free outside Azure, and an incremental
EUR 10/month low-traffic target (not a guaranteed spending cap).
The approved photo policy is ordinary JPEG/PNG/WebP/HEIC/HEIF up to 50 MiB and
64 megapixels, normalized to at most 3 MiB; RAW/DNG is excluded.

- [x] Confirm target subscription, region, resource-group name and budget.
- [x] Compare retaining PostgreSQL/PostGIS plus managed auth with an all-Azure
  alternative; document services that cannot live in an Azure resource group.
- [x] Define accepted photo formats, source byte/pixel limits, normalization,
  private Blob access and storage limits.
- [x] Reuse the existing AI resource for non-production testing only.
- [x] Finalize the implementation/provisioning plan and get scoped approval.
- [ ] Implement Blob integration, upload safeguards and infrastructure.
- [ ] Configure backend, authentication and the two approved admin identities.
- [ ] Run azure-validate, then azure-deploy for the approved targets.
- [ ] Verify deployed workflows and publish versioned deployment records.

### Preparation completed before the network-design hold

- Private Blob adapter, managed-identity authentication, ten-minute read-only
  moderator URLs and safe cleanup for definite insert rollbacks are implemented.
- Real JPEG/PNG/WebP and HEIC processing supports the approved source bounds,
  strips metadata and caps stored WebP at 3 MiB. RAW and animations are rejected.
- Public/admin builds pass independently. The admin signer does not import the
  public upload worker. A packaged 64-MP HEIC decode succeeded in a local,
  network-isolated 1-vCPU/2-GiB public container with about 1283 MiB peak decoder
  RSS. Both container runtimes passed their boundary smoke.
- Actual standalone HTTP accepted 50 MiB through input validation and reached a
  synthetic quota denial; one byte over the file limit was rejected. No inference
  or real storage write was performed. The upload route avoids Next proxy's
  default 10-MB cloned-body truncation.
- Bicep compilation and resource contracts pass locally. The updated templates
  require non-empty secure IP inputs, app Allow-only host rules and Blob default
  Deny. Internal Blob connectivity remains unimplemented, not silently opened.
- The release workflow separates development/production settings and records,
  compares actual app rules with private approved IPs, and hard-blocks deployment.
- Direct provider reads reported 0/50 regional environments and 0/250 storage
  accounts. Microsoft.Quota was unregistered; compute capacity, complete policy
  evaluation, real-parameter ARM validation and what-if are still outstanding.
- See `docs/18-private-deployment-and-photos.md` for the implementation and the
  remaining private-network/backend decisions. Backend setup was deferred by
  the owner, and no real administrator identities or backend keys were supplied.

No cloud resources, roles or live database settings have been changed by
this planning update. Keep resource/account identifiers and credentials out
of committed configuration.

### Proposed lowest-change, low-cost architecture

- New resource group `rg-clamp-ireland-dev`, region North Europe.
- Two Container Apps on Consumption: minimum zero replicas, maximum one each.
  Use public GHCR images without credentials baked in; avoid a paid registry,
  dedicated compute, NAT gateways and private endpoints for this first version.
- Private Standard StorageV2 Hot LRS Blob storage, using managed identity and
  narrowly scoped, short-lived moderator access. Store processed images only.
  The original unrestricted public endpoint design is superseded by the
  all-endpoint IP-isolation requirement above.
- Retain Supabase Free for PostgreSQL/PostGIS and Auth rather than porting to
  MySQL. This is explicitly hybrid: Supabase is outside the Azure resource group.
  Free limits include 500 MB database and 50,000 MAU, but pausing after one week
  of inactivity and no automatic backups are material launch limitations.
- Public email registration requires custom SMTP. Supabase's built-in sender
  only delivers to project-team addresses and is not a production option.
- Proposed photo policy: one image per report, ordinary JPEG/PNG/WebP/HEIC/HEIF
  sources up to 50 MiB and 64 megapixels; validate decoded content, orient,
  strip metadata and resize/recompress to at most 3 MiB before Blob persistence.
  DNG/ProRAW originals are excluded initially; users can export them as JPEG.
  These are application limits, not a claimed universal iPhone file maximum.
- Reuse the existing AI deployment for testing; the only pre-existing shared
  Azure service outside the new group. Reassess AI placement before production.
- Owner approved a EUR 10/month low-traffic target. No automatic paid-tier upgrade.
  Budget alerts are notifications, not a hard cap on consumption charges.

### Public-production billing restriction

Read-only ARM inspection identified the supplied subscription's offer as
`MSDN_2014-09-01`, with its spending limit on. Microsoft documents the Visual
Studio monthly-credit benefit as **development and testing only**, without
a financially backed SLA. Obtain a production-eligible subscription before
public launch; do not change its spending limit or relabel production as a demo.

For scale: public retail pricing currently lists North Europe Hot LRS capacity
at EUR 0.0189 per GB-month. About 1,000 processed 3-MiB images would therefore
cost roughly EUR 0.06/month in capacity alone, excluding operations, transfer,
retained versions and tax. Hosting, email and inference are separate charges;
low-traffic estimates are not guaranteed bills. Container Apps grants are
shared at subscription level, not multiplied by apps/resource groups.

Apple documents approximately 75 MB for a 48-MP ProRAW image, not an absolute
maximum. Ordinary phone uploads and RAW archival are different requirements.
The fetched iPhone 18 specification page did not establish a file-size bound.

Official sources checked:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/auth/auth-smtp
- https://azure.microsoft.com/en-us/pricing/member-offers/credit-for-visual-studio-subscribers/
- https://prices.azure.com/api/retail/prices
- https://support.apple.com/en-ie/119916

## Previous preparation and readiness evidence

Status: **Preparation verified; deployment blocked and on hold**.

Cloud deployment: **on hold by explicit owner choice**. Azure validation
assessed the prepared release path; missing production prerequisites prevent a
`Validated` deployment status. No deployment or provisioning is authorized.

## Current preparation request

Prepare modular GitHub Actions, unit/integration/smoke test gates, release tags,
deployment version records, an Azure-backed one-sentence summary demonstration,
and text/username content moderation. Inspect existing implementations before
finalizing the plan. This request does not yet authorize production deployment,
new model deployments, resource creation, role changes or database migrations.

- [x] Inspect existing test, release, summary and account/report entry points.
- [x] Inspect available deployments on the owner's existing AI resource read-only.
- [x] Confirm preparation scope, live demonstration limits and moderation policy.
- [x] Implement approved changes and verify local builds, unit/SQL/release
  contracts, synthetic live AI and both isolated Linux container runtimes.
- [x] Finish hosted CI smoke validation and record deployment readiness blockers.

## Implemented artifacts and local evidence

- `.github/workflows/ci.yml`: PR/master test and production smoke gates.
- `.github/workflows/release.yml`: manual tagged release; deployment requires
  opt-in, a protected production environment and Azure OIDC.
- `Dockerfile`: independent public/admin standalone targets.
- `scripts/release`: validated tags/metadata, digest-only promotion, bounded
  read-only smoke and durable sanitized attempt records.
- `src/modules/ai`, `ai-demo`, `content-policy`: server-only Azure provider,
  synthetic local demo and report/username admission checks.
- Migrations 0006 and 0007 prepared, not applied.
- Local verification: both final application builds pass; public/admin Linux
  image builds and network-isolated container smoke pass. Unit/server, SQL and
  release contracts pass. Integrated development coverage exposed a small-phone
  banner regression and a production-only test selector; both were corrected
  and focused regressions pass.
- Real Azure synthetic summary and moderation calls succeeded using the
  existing deployment and local CLI identity, within the ten-attempt approval.
- Source milestones have been committed/pushed regularly. Hosted CI succeeded;
  no manual release or deployment workflow has been dispatched.

## Known deployment blockers

Production targets are not provisioned/configured for this app. GitHub
release/production environments, reviewer protection, OIDC and build/runtime
settings still need owner-approved setup. Supabase, both real administrator
identities, migrations, private photo-storage choice, production inference
permissions, domains and privacy/launch approval remain unresolved. The
workflow rejects missing configuration rather than provisioning resources or
deploying an unconfigured success-shaped fallback.

## All validation checks pass

This overall deployment checkbox remains incomplete:

- [x] Azure CLI installation verified.
- [x] Authentication to the owner-approved subscription verified read-only.
- [ ] Bicep compilation: no infrastructure template was requested/generated;
  the pipeline promotes images to separately provisioned existing targets.
- [ ] ARM template validation and what-if: not applicable to these image-only
  artifacts; future provisioning requires a separate approved plan.
- [x] Both independent Linux Docker builds and isolated container smoke pass.
- [ ] Production target, Azure Policy and static role verification: blocked
  until the owner approves/provisions targets and runtime/OIDC identities.
- [x] GitHub CI executes the actual lint/unit/SQL/release and production gates.
- [ ] GitHub release/production environments, protected reviewers, deployment
  opt-in and required settings: absent, so deployment is deliberately denied.

## 7. Validation Proof

The table below records the original `v0.1.0` preparation baseline.

| Check | Actual command/evidence | Result |
| --- | --- | --- |
| CLI | `az version --output json` | Installed |
| Authentication | `az account show` scoped to the approved subscription, state-only projection | Enabled; no default subscription changed |
| App builds | `npm run build:all` | Public and private admin builds passed |
| Unit/server | `npm run test:unit` | 74 passed, mocked transport/no paid inference |
| SQL | `npm run test:sql` | 16 passed in PGlite; no live migrations |
| Release controls | `npm run test:release` | 15 passed |
| Linux packaging | `docker build --target public` and `--target admin`, synthetic build identity | Both built locally; no registry push |
| Container execution | `node scripts/release/container-smoke.mjs` | Both passed with external networking disabled; test containers removed |
| Hosted CI | GitHub Actions run `35754929186`, commit `287a0e3d3bce936fbd79129ae33bb77517019318` | Success, including 7 production browser smoke tests |
| Source version | Annotated tag `v0.1.0` at the above CI-verified commit | Pushed; source tag is not a deployment claim |
| Deployment prerequisites | GitHub environment/variable/secret names inspected read-only | No configured environments/required settings; deployment blocked |
| Role templates | No IaC role assignments generated | Production roles unverified; no role changes authorized |

### Readiness recheck: 2026-09-22

- Application commit `961ebb167b812fbd8f25d1933ec3e45c932e1eb5` passed
  hosted CI run `35759192462`: lint/unit/server/SQL and both production
  builds with synthetic browser smoke.
- `gh api repos/SaM-92/clamp-ireland/environments` returned no environments.
  Repository variable and secret **name-only** listings were also empty.
  Release/production setup, reviewer protection and deployment settings
  therefore remain blockers.
- `Test-Path infra\main.bicep` returned false. There is no approved
  provisioning template to compile, validate or run what-if against.
  Production targets, RBAC and real backend operations remain unverified.
- `git rev-list -1 v0.1.0` resolved to `287a0e3...`, not the latest application
  commit. Before releasing the newer fixes, commit a new package version and
  matching source tag; do not move the published baseline tag.
- Migration 0007 is now required for concise v2 summaries, in addition to
  the prior backend migrations. No live migration was performed.

Result: **code and release automation are verified; production deployment
readiness is still blocked**. This readiness question did not lift the
owner's hold or authorize provisioning, identity changes or deployment.

Local Azure inference was verified separately using only fixed synthetic
examples and the existing CLI identity. It does not establish managed-identity
access in production. Backend identities, image storage and real user flows
remain launch prerequisites. Do not invoke azure-deploy from this state.

## Proposed implementation scope

Mode: MODIFY. Stack: two independent Next.js/TypeScript applications, Supabase
data/auth and private image storage. Existing Playwright tests include pure
contracts, mocked server integrations, SQL policy checks and browser workflows.
Before this preparation, no GitHub Actions workflows or deployment
environments existed. Workflows are now implemented; environments remain absent.

Recipe: GitHub Actions with Azure CLI for a manually approved release pipeline
to separately provisioned Container Apps. Custom release/version recording and
immutable container promotion are the reasons to use the AZCLI recipe rather
than introducing azd. Initial infrastructure creation is not part of this
preparation change; the workflow must explicitly reject missing configuration.

1. CI on pull requests and the default branch: lockfile install, lint, explicit
   unit/server/SQL tests, both production builds and production-mode smoke tests.
   External identity/model transports are mocked; CI must not spend model tokens.
2. Release preparation and manually dispatched deployment: semantic version
   tags, commit-addressed public/admin images, digest-pinned deployment,
   protected GitHub environment/OIDC authentication, and post-deployment smoke
   checks. Merely pushing code or a tag must not deploy to Azure.
3. Version records: build version/commit metadata, release notes, per-attempt
   deployment manifests and GitHub run/environment history. Failed/partial
   deployments must be recorded as failures, never reported as a successful
   release. No sensitive configuration in public artifacts.
4. Summaries: use the existing Azure GPT-5 mini deployment through a shared,
   bounded server-only Responses client. Keep one-sentence validation, manual
   triggering, caching and separate human approval. No always-running hosted
   agent and no new model deployment are necessary.
5. Local demonstration: show synthetic sample notes and a visibly labelled
   real Azure result/status, with an explicit click and bounded calls. Keep
   simulation distinct from live inference. Do not unlock private admin or
   introduce a production unauthenticated inference endpoint.
6. Content policy: a modular server-side gate for report text and username
   writes, inexpensive deterministic checks plus the existing small model for
   context. Block profanity, harassment, slurs, threats and abusive usernames,
   but permit non-abusive factual criticism. Validate AI responses strictly;
   provider failure blocks submission with a retryable service error, not a
   claim that the user's language was abusive. Preserve human publication review.
   Ensure direct database/profile writes cannot bypass the gate; prepare any
   required migration without applying it to live services.
7. Add focused policy/provider/version unit tests and browser/API smoke tests,
   including allowed criticism, rejected abuse, unavailable AI, malformed AI,
   prompt injection, identity boundaries and unchanged scoring/voting.
   Update README and handoffs, then make meaningful commits and push.

## Existing AI resource inspection

The owner's supplied AI Services resource has a successfully provisioned
`gpt-5-mini` deployment (GlobalStandard). Reuse it; this is a low-cost candidate
already compatible with the summary contract, not a claim that it is the
cheapest model on the market. Read-only management lookup does not prove
data-plane inference access. Prefer Entra authentication; keep credentials and
resource identifiers out of this public repository. Azure MCP is unavailable
in this session, so inspection used Azure CLI and official Microsoft docs.

GlobalStandard is not a guarantee of EU-only processing. Only synthetic notes
may be used for the local demonstration until production data-processing
disclosures and configuration have been reviewed.

## Approval and validation boundaries

The owner approved implementation and a real Azure demonstration, while
explicitly selecting preparation/testing only and keeping deployment on hold.
The proposed local demonstration uses at most ten short synthetic inference
requests against the existing model; it may incur small usage charges.
No resource/role creation, application deployment, database migration or
provider-account change is included. Confirm cloud subscription, region,
architecture, image registry access and budget separately before provisioning.
Live deployment readiness cannot be claimed until backend/admin identities,
OIDC/protected environment, application targets and private photo storage
decisions are configured. Invoke azure-validate before any eventual deployment.

## Approved application change

Separate the public community website and administration website into
independent Next.js applications/builds. The administration website may expose
a sign-in page over the internet, but dashboard pages and administrative APIs
must permit only two explicitly configured, confirmed accounts. No admin
registration or unauthenticated dashboard preview.

## Cloud approval boundary

No resource creation, deployment, database migration or identity-provider
configuration is approved by this change. Architecture handoff 13 remains a
recommendation, not authorization. Subscription identifiers and account
identifiers must not be committed.

## Pending deployment decisions

- Confirm hosting/data architecture, region, domains and incremental budget.
- Select the deployment recipe only when infrastructure work is requested.
- Specify separate public/admin hosting, credentials and identity settings.
- Configure the two approved account IDs through private server settings.
- Review Blob integration, email delivery, backups and launch safeguards.
- Validate the finalized deployment plan before any deployment.

## Local implementation

- [x] Inspect shared modules and current administration routes.
- [x] Separate administration routes/build and enforce the account allowlist.
- [x] Remove public administration entry points and preview bypasses.
- [x] Verify public isolation, administrator authorization and existing workflows.
- [x] Update handoffs and prepare the source changes for publication.

Local verification covers both builds and the real page/API gates with test
identity transport. Real backend credentials, both approved accounts, TLS,
domains and Azure resources remain unconfigured and require separate approval.

### Infrastructure authoring - 2026-09-23

- Domain `clamptracker.ie` is now registered and active at Blacknight, but no
  DNS records have been created yet. Planned admin hostname:
  `admin.clamptracker.ie`.
- The initial IP-restricted test deployment will use operator IPv4
  `98.71.6.33` for app ingress and backend firewall verification.
- Container Apps, Azure SQL, Storage and staged deployment orchestration are
  now documented as authored-but-not-yet-deployed infrastructure.
- See `docs/21-container-apps-deployment.md` for the detailed deployment
  runbook, required inputs and post-deploy SQL grant step.

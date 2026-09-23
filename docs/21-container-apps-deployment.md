# Container Apps deployment handoff

## Scope and honest status

This handoff records the active Azure deployment plan after persistence moved
from embedded SQLite to Azure SQL Database (`docs/20-azure-sql-migration.md`).
As of 2026-09-23, **nothing has been deployed to live Azure for this plan yet**.
The work completed here is infrastructure authoring and deployment-runbook
preparation only.

The intended deployment surface is:

- `infra/network-types.bicep`
- `infra/environment.bicep`
- `infra/sql.bicep`
- `infra/storage.bicep`
- `infra/container-app.bicep`
- `scripts/deploy/deploy-infra.ps1`

There is deliberately **no single subscription-scope `main.bicep`**: SQL and
Storage firewall allowlists can only be finalized once the Container Apps
environment exists and reports its real outbound egress IPs, which a one-shot
Bicep deployment cannot query mid-run. `deploy-infra.ps1` instead deploys each
module directly with staged, resource-group-scoped `az deployment group
create` calls, reading each step's outputs before deciding the next step's
parameters.

Historical directories remain for reference only:

- `infra/preflight/`: read-only subscription/SKU validation, now superseded by
  the real SQL/storage/environment modules.
- `infra/legacy-container-apps/`: retired Supabase/VM-era design and firewall
  contract-test history; not the active deployment plan.

## Finalized architecture

- **Resource group / primary app region**: `rg-clamp-ireland-dev` in
  **North Europe**.
- **Runtime**: one shared **Consumption-only** Azure Container Apps managed
  environment, no custom VNet, no workload profile, Log Analytics enabled with
  a 1 GiB/day ingestion cap and 30-day retention.
- **Container Apps**:
  - Public app: Consumption, single active revision, min 0 / max 1 replicas,
    1 vCPU / 2 GiB.
  - Admin app: Consumption, single active revision, min 0 / max 1 replicas,
    0.25 vCPU / 0.5 GiB.
- **Database**: Azure SQL Database in **Sweden Central**, using the free-offer
  serverless General Purpose SKU (`GP_S_Gen5`, capacity 1), 15-minute
  autopause, 32 GiB max size, Entra-only authentication, and free-offer
  exhaustion behavior set to pause rather than spill into paid usage.
- **Storage**: Standard `StorageV2` Hot LRS account in **Sweden Central** with
  private Blob storage and one container, `report-images`.
- **Identity / RBAC**: one user-assigned managed identity per Container App,
  with both identities granted `Storage Blob Data Contributor` on the storage
  account.
- **Images**: the existing `Dockerfile` supplies `public` and `admin` targets,
  published as digest-pinned GHCR images and passed into deployment as
  `-PublicImage` / `-AdminImage`. `infra/container-app.bicep` supports an
  optional GHCR pull credential (`registryUsername`/`registryPassword`,
  skipped entirely when `registryUsername` is empty) — GHCR defaults new
  packages to **private**, so confirm/set the package visibility (or supply a
  read:packages token) before deployment.
- **Networking**: no private endpoints, no NAT gateway and no custom VNet,
  because those fixed-cost resources are outside the approved low-traffic
  budget. Instead, SQL and Storage keep public network access enabled but use
  deny-all-by-default firewalls that allow only the Container Apps egress IPs
  discovered after environment creation plus the operator IP used for setup and
  verification. For the first deployment, both app ingresses are also
  intentionally restricted to the operator IP only; they are not meant to be
  public yet.

This is a deliberate low-cost, fail-closed test deployment, not an open
internet launch.

## Staged deploy sequence

`scripts/deploy/deploy-infra.ps1` is the deployment runbook entrypoint. At a
high level it is expected to run in this order:

1. Supply deployment-time inputs including `-SqlAdminObjectId`,
   `-GoogleClientId`, `-GoogleClientSecret`, `-PublicImage`, `-AdminImage` and
   `-OperatorIpv4` (currently `98.71.6.33` for the initial test deployment),
   plus the two administrator Google account UUIDs once they exist.
2. Create or update the resource group and shared Container Apps environment in
   North Europe, including Log Analytics.
3. Create the two user-assigned managed identities for the public and admin
   apps.
4. Query the actual outbound egress IPs once the environment/identities exist;
   a Consumption environment does not start with a pre-approved fixed egress
   list.
5. Create or update Azure SQL Database and the Storage account in Sweden
   Central with public network access enabled but backend firewalls defaulting
   to deny, then allow only the discovered Container Apps egress IPs plus the
   operator IP.
6. Deploy the public and admin Container Apps from the digest-pinned GHCR
   images, using single active revisions, scale-to-zero settings and ingress
   rules restricted to the operator IP for the initial verification phase.
7. Apply RBAC so both managed identities receive `Storage Blob Data
   Contributor` on the storage account.
8. Reconcile the final SQL/Storage firewall rules after the apps exist, then
   emit the `grant-sql-users.sql` guidance for the required manual SQL
   data-plane step.

The important operational detail is that SQL/Storage allowlists cannot be
finalized until the environment exists and reports its real outbound IPs.

## Required inputs and secrets

| Input | Purpose | Status |
| --- | --- | --- |
| `-SqlAdminObjectId` | Entra object ID for the Azure SQL logical server administrator | Required at deploy time |
| `-OperatorIpv4` | Temporary allowlisted IP for ingress, SQL and Storage setup/verification | Known for this run: `98.71.6.33` |
| `-PublicImage` / `-AdminImage` | Digest-pinned GHCR image references for the two apps | Required; use the published digests for the release being deployed |
| `-GoogleClientId` / `-GoogleClientSecret` | Google OAuth configuration for both apps | **Still missing from the owner** |
| Two admin Google account UUIDs | Seeds the strict admin allowlist | **Still missing from the owner** |
| GHCR package visibility | Confirms whether unauthenticated pulls are valid | GHCR defaults to private; `infra/container-app.bicep`'s optional `registryUsername`/`registryPassword` params cover this if needed |

## Manual post-deploy SQL grant

Azure SQL has no ARM-native step for creating contained database users for the
two managed identities. After the infrastructure deployment finishes, the
operator must:

1. Use the generated `scripts/deploy/grant-sql-users.sql`.
2. Connect as the Entra SQL administrator with `sqlcmd -G`.
3. Run the `CREATE USER [...] FROM EXTERNAL PROVIDER` statements and the role
   grants for the public/admin managed identities.

Until that data-plane step is completed, the apps can exist but will not have
working database access.

## DNS and custom-domain follow-up

`clamptracker.ie` is already registered and active at Blacknight, but the DNS
records have not been created yet. The admin hostname will be
`admin.clamptracker.ie`; the public site also still needs its production DNS
records.

Container Apps custom-domain binding requires the DNS records to resolve first,
so the first deployment will be reachable only through the default
`*.azurecontainerapps.io` hostnames until DNS, custom-domain binding and the
managed certificates are completed.

## Not done yet

- Run the live Azure deployment; nothing has been provisioned yet.
- Publish/confirm the exact digest-pinned `-PublicImage` and `-AdminImage`
  values for the deployment being executed.
- Confirm whether the GHCR packages are public; if not, supply
  `-RegistryUsername`/`-RegistryPassword` (a GHCR PAT with `read:packages`)
  when running the deploy script.
- Supply the Google OAuth client ID and client secret.
- Supply the two administrator Google account UUIDs.
- Run the manual `grant-sql-users.sql` step as the Entra SQL admin.
- Create the DNS records for `clamptracker.ie` / `admin.clamptracker.ie`.
- Bind the custom domains and managed certificates in Container Apps.
- Verify the IP-restricted deployment from inside and outside the allowlist.
- Open public ingress later only if/when the owner approves moving past the
  initial operator-only test posture.

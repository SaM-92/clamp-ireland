# Azure architecture consultation

Status: **recommendation only; not approved for deployment**.
Reviewed 22 September 2026 by independent Claude Opus 5 and GPT-6 Astra
architecture agents, both at extra-high effort.

The owner wants personal-subscription Azure hosting, Azure Blob Storage for
photos, and very low-cost user/report data. No resources, permissions, accounts,
deployment workflows or infrastructure definitions were created by this
consultation. Cloud identifiers and details of unrelated applications are
intentionally not recorded in this public handoff.

## Recommended first version

- Separate resource group for ownership, cost attribution and access isolation.
  Resource groups themselves have no hosting fee.
- Separate Azure Container Apps Consumption deployments for the community
  Next.js server and private admin Next.js server, starting
  with scale-to-zero and one maximum replica. Size after local/container
  measurement rather than assuming the smallest allocation is sufficient.
  The later private-admin decision is implemented locally (handoff 14), not
  deployed. Both apps consume the same subscription-level allowance; admin
  compute/logging is an additional usage line, not assumed free.
- Dedicated Standard StorageV2 **Hot LRS** account for private photo blobs.
  No anonymous blob access. Authorize the app with managed identity, and
  provide tightly scoped, short-lived moderator access rather than account
  keys or public originals.
- **Supabase Free for PostgreSQL/PostGIS and authentication**, retaining the
  existing transactions, geographic queries, moderation policies and SDK.
- Public GitHub Container Registry image, without baked credentials, rather
  than paying a registry's standing charge solely for this small application.
- Minimal necessary logging. No automatic addition of dedicated compute,
  private endpoints, NAT gateways or premium monitoring products.

This is deliberately a **hybrid**, not an all-Azure data/auth stack. Both
architects preferred it for this implementation. The owner must confirm
whether retaining Supabase is acceptable before this recommendation becomes
an implementation plan.

## Important billing correction

Container Apps' monthly allowance is **per subscription**, not per app,
resource group or environment: 180,000 vCPU-seconds, 360,000 GiB-seconds and
two million requests. Other workloads can consume it. A separate environment
does not create another allowance.

Do not budget this project as guaranteed free hosting. An illustrative
**0.5-vCPU / 1-GiB** replica, assuming no available compute grant and active
rates of USD 0.000024/vCPU-second and USD 0.000003/GiB-second, costs:

| Running replica-hours in a month | Compute and memory only |
|---|---:|
| 50 | USD 2.70 |
| 100 | USD 5.40 |
| 150 | USD 8.10 |
| 720 | USD 38.88 |

These are arithmetic scenarios, **not a bill forecast or an EUR quote**.
With minimum replicas zero, time waiting to scale down is still running
time at active rates. Pageviews do not determine replica-hours. A permanently
warm minimum replica has different idle/active billing rules.

Add Blob capacity/operations, possible transfer, logs, email delivery, model
usage and tax. Photos accumulate unless a retention policy removes them.
Budget alerts notify; they do not impose a hard spending cap. Subscription
credits, free-offer eligibility and actual billed usage were not established.

## Database alternatives

| Choice | Why it is not the first recommendation |
|---|---|
| Azure Table Storage | Low unit cost, but no native spatial index or relational joins; transactions are partition-bounded. Requires geographic indexing, exact-distance filtering, relationship and authorization work. |
| Cosmos DB NoSQL free tier | Strong Azure-only low-cash-cost contender: 1,000 RU/s and 25 GB within the free offer. One account per subscription, chosen at creation; **not available for serverless**. Requires a document/partition and transaction redesign. Eligibility is not assumed. |
| Cosmos DB serverless | Usage-based RUs and storage, not the provisioned free tier. Spatial support helps, but existing PostgreSQL joins, policies and cache invariants still need redesign. |
| Azure SQL Database free offer | Relational and spatial features; ongoing 100,000 vCore-seconds, 32 GB data and 32 GB backup per database/month, subject to offer terms. T-SQL, SDK and auth port required. Quota-pausing and cold resumes are material availability compromises. |
| Azure PostgreSQL Flexible Server | Preserves PostgreSQL/PostGIS, but does not supply Supabase Auth/PostgREST. Eligible new-customer free benefits are time-limited, not a permanent low-traffic free tier; later compute/storage charges can exceed the budget. |

There is currently no live project data to migrate as part of this prototype.
An Azure-only choice therefore means **code/data-model/auth porting**, not an
assumed forced password reset for existing users.

If Azure-only is mandatory, first verify Cosmos free-tier eligibility and
compare its redesign effort against Azure SQL's relational fit and free-quota
availability limits. Entra External ID is the relevant Azure identity option
(base offer includes 50,000 MAU); do not assume this is a drop-in replacement
for Supabase sessions or `auth.uid()` policies.

## Before any implementation or deployment

1. Owner confirms hybrid versus Azure-only, incremental spending budget,
   region and whether any existing resources may be shared.
2. Produce the actual deployment plan and explicit resource list; obtain
   deployment approval separately. Supplying a subscription identifier is
   not itself permission to deploy.
3. For Blob integration, replace the storage adapter without bypassing
   moderation. Validate image content/size, strip EXIF, use generated names,
   handle failed-upload/report-write cleanup, and document retention/erasure.
4. Preserve private email/public-pseudonym separation, confirmed-user write
   gates, admin-only review and source-fresh summary publication.
5. Apply approved migrations and exercise real geographic boundary,
   auth, Blob access and recovery checks before public launch.
6. Configure email delivery, privacy/terms, abuse controls and backup/recovery.
   Supabase Free can pause after inactivity and includes no automatic backups;
   there is no promised keepalive workaround.
7. Leave indexing, traffic collection and paid AI generation opt-in until
   their independent readiness/privacy/cost checks are complete.

The 100 m circles are visual context, **not coordinate anonymisation**.
Thirty-metre deduplication and 500 m summarisation are distinct operations.

## Official references

- [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
- [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
- [Disable anonymous Blob reads](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-prevent)
- [User-delegation SAS](https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas)
- [Supabase pricing and free-plan limitations](https://supabase.com/pricing)
- [Cosmos free-tier terms](https://learn.microsoft.com/en-us/azure/cosmos-db/free-tier)
- [Azure SQL free offer](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql)
- [Table Storage design](https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design)
- [Azure PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/)
- [External ID pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-entra-external-id/)
- [Budget alerts are not spending stops](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

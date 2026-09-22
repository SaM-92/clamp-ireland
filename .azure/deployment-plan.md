# Deployment preparation status

Status: **deployment on hold; local application separation approved**.

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

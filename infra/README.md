# Container Apps infrastructure

Persistence now lives in Azure SQL Database rather than local SQLite, so the
application is compatible with stateless Azure Container Apps. The active
deployment entrypoint is `scripts/deploy/deploy-infra.ps1`, which deploys
`environment.bicep`, `sql.bicep`, `storage.bicep` and `container-app.bicep`
directly as staged, resource-group-scoped `az deployment group create` calls
(in that order) rather than through a single subscription-scope `main.bicep` -
SQL/Storage firewall allowlists can only be finalized after the Container Apps
environment exists and reports its real outbound IPs, which a one-shot Bicep
template cannot query mid-deployment.

`preflight/` was read-only validation only and is superseded by the modular
Container Apps/Azure SQL templates now that `infra/sql.bicep` exists.
`legacy-container-apps/` preserves the retired Supabase/VM-era design and
firewall contract-test history only; do not deploy it.

For the staged deployment runbook, manual SQL grant step and current live-Azure
status, see `docs/21-container-apps-deployment.md` and
`.azure/deployment-plan.md`.

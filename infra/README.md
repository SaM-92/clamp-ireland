# Cloud deployment remains blocked

There is no active Azure provisioning entrypoint for the SQLite application.
`legacy-container-apps/` preserves the earlier, **retired** two-Container-Apps /
hosted-database design for reference and firewall contract tests. Do not deploy it.

SQLite requires one persistent host and local disk shared by both application
processes. Ephemeral Container Apps storage and shared Azure Files/SMB/NFS are
not supported. `compose.yaml` is a local, loopback-only setup, not approval to
provision a VM or expose ports publicly.

Before replacing the deployment hold, obtain approval for hosting cost and
durable storage, design private Blob/inference connectivity, supply approved IPs
at deployment time, and validate backups, restore and inside/outside access.
See `docs/19-sqlite-google-handoff.md` and `.azure/deployment-plan.md`.

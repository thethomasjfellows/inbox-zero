# qFido recovery and rollback boundary

## Data authorities

- PostgreSQL: PVC `data-inbox-zero-postgresql-0`, 20Gi.
- Redis: PVC `data-inbox-zero-redis-0`, 5Gi.
- Runtime/OAuth/application secrets: external Kubernetes Secret `inbox-zero-runtime-secret`.
- Codex CLI authentication/configuration: external Secret `inbox-zero-codex-cli`.

The baseline observed a successful state-backup indicator through `2026-07-20T07:08:41Z`. Wave 3 did not read backup payloads or Secret values and did not perform a fresh restore. RPO and RTO remain unapproved blockers.

## Gate before any future rollout

1. Capture the complete live Helm values and rendered manifests while redacting Secret values.
2. Record exact current and candidate image tags/digests, chart/repository SHAs, cutover owner, rollback owner, and verification window.
3. Verify backup freshness, checksum/remote copy, retention, and the credential path needed for recovery.
4. Restore Postgres and Redis into isolated storage and verify application migrations plus representative reads.
5. Review Prisma/schema compatibility with the previous image. Do not claim image rollback if the previous image cannot read the migrated schema.
6. Render and review the qFido overlay; prove it creates no Kubernetes Secret and preserves PVC identities.
7. Verify web/worker readiness, public health, authentication, provider connectivity, scheduled jobs, queue processing, logs, restarts, and data integrity.
8. Keep the prior image/package, complete pre-cutover values, and verified backup through the rollback window.

No package cleanup, live cutover, or Thomas OS documentation deletion is authorized by this file.

# qFido Kubernetes ownership

This repository owns the Inbox Zero application chart and the qFido non-secret deployment overlay at `deploy/qfido/values.yaml`. The overlay was reconstructed from read-only Helm, Kubernetes workload, ConfigMap, PVC, package, and image-ID metadata on 2026-07-21.

Wave 3 is preparation only. Do not run Helm upgrade, apply manifests, publish an image, alter a Secret, or cut over any workload from this branch.

## Ownership boundaries

- This repository owns Inbox Zero web/worker/CronJobs, bundled Postgres/Redis/Redis-HTTP, Service, Ingress, and namespace-scoped configuration.
- Rancher owns cluster-wide ingress/certificate/control-plane resources.
- Infisical owns future secret synchronization and shared pull-secret resources.
- Secret values remain outside Git in `inbox-zero-runtime-secret` and `inbox-zero-codex-cli`.
- PostgreSQL and Redis PVC contents, logs, OAuth state, email data, dumps, snapshots, and backups are runtime data and never belong in Git.

The chart now supports optional digest pins. The qFido overlay pins every observed container digest and renders no Kubernetes Secret object.

## Validation

```bash
bash scripts/validate-qfido-deployment.sh
```

A future live action must use `helm diff` or an equivalent reviewed dry run, capture complete pre-cutover values without committing secrets, and pass the recovery gate.

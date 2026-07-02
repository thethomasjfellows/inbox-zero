# Kubernetes + Codex CLI LLM: Plan

## Goal
Deploy Inbox Zero on the user's Kubernetes infrastructure using the existing Helm chart as the base, with production-grade stateful services, secret handling, ingress, worker, and CronJob operations. The LLM path is Codex CLI with ChatGPT/Codex CLI auth, not OpenAI API credentials.

## Background
- The repo already ships a Helm chart at `charts/inbox-zero`; the Kubernetes guide says the runtime pieces are a `web` Deployment, a Prisma migration Job, optional BullMQ `worker` Deployment, CronJobs, Postgres/Redis, and an Ingress (`docs/hosting/kubernetes.mdx:6-13`).
- The chart README says production should use managed Postgres and Redis; bundled StatefulSets are for demos/small installs, not production workloads needing backups/failover/restores (`charts/inbox-zero/README.md:3-12`).
- Chart defaults use image `ghcr.io/elie222/inbox-zero:latest`, `QUEUE_BACKEND: bullmq`, `worker.enabled: true`, CronJobs enabled, bundled Postgres/Redis/Redis HTTP enabled, and `DEFAULT_LLMS: openai:gpt-5.4-mini` (`charts/inbox-zero/values.yaml:6-9`, `charts/inbox-zero/values.yaml:77-85`, `charts/inbox-zero/values.yaml:113-213`).
- Kubernetes production docs recommend `externalDatabase.existingSecret` with `DATABASE_URL`/`DIRECT_URL`, `externalRedis.existingSecret` with `REDIS_URL`/`UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN`, and `existingSecret` for app secrets (`docs/hosting/kubernetes.mdx:88-104`).
- The web runtime requires core env including `DATABASE_URL`, Google OAuth values, encryption secrets, `DEFAULT_LLMS`, `GOOGLE_PUBSUB_TOPIC_NAME`, and `INTERNAL_API_KEY` (`apps/web/env.ts:53-109`, `apps/web/env.ts:204-207`, `apps/web/env.ts:282-283`; `docs/hosting/environment-variables.mdx:12-55`).
- The container image is built from `docker/Dockerfile.prod`, copies the standalone Next.js server and `@inboxzero/worker`, exposes port 3000, and defaults to `/app/docker/scripts/start.sh`; startup replaces `NEXT_PUBLIC_*` placeholders and runs migrations unless `SKIP_DB_MIGRATIONS=true` (`docker/Dockerfile.prod:96-118`, `docker/Dockerfile.prod:135-137`, `docker/scripts/start.sh:8-22`).
- With external managed Postgres and `migrations.enabled`, Helm creates a pre-install/pre-upgrade migration Job and web sets `SKIP_DB_MIGRATIONS=true` (`charts/inbox-zero/templates/migration-job.yaml:1-12`, `charts/inbox-zero/templates/web-deployment.yaml:79-82`).
- BullMQ production mode needs Redis plus the worker. Worker requires `REDIS_URL`, `INTERNAL_API_KEY`, and `INTERNAL_API_URL` or `NEXT_PUBLIC_BASE_URL`, then forwards jobs to the internal web service with `x-api-key` (`apps/worker/src/runtime.mjs:106-130`, `apps/worker/src/runtime.mjs:73-98`).
- The chart CronJobs call internal web URLs with `Authorization: Bearer $CRON_SECRET` (`charts/inbox-zero/templates/cronjobs.yaml:1-43`). Watch renewal, meeting briefs, digest, automation jobs, follow-up reminders, and cleanup jobs are configured in chart defaults (`charts/inbox-zero/values.yaml:213-256`).
- Gmail push uses Google Pub/Sub to `/api/google/webhook`; it requires `GOOGLE_PUBSUB_VERIFICATION_TOKEN` unless intentionally disabled and registers watches using `GOOGLE_PUBSUB_TOPIC_NAME` (`apps/web/app/api/google/webhook/route.ts:24-41`, `apps/web/utils/gmail/watch.ts:10-40`). Outlook uses Microsoft Graph subscription notifications with `MICROSOFT_WEBHOOK_CLIENT_STATE` (`apps/web/app/api/outlook/webhook/route.ts:17-68`, `apps/web/utils/outlook/watch.ts:10-24`).
- LLM config is env-driven. `DEFAULT_LLMS` is required; `ECONOMY_LLMS`, `CHAT_LLMS`, `NANO_LLMS`, and `DRAFT_LLMS` are optional ordered fallback chains in `provider:model` form (`apps/web/env.ts:109-114`, `docs/hosting/llm-setup.mdx:39-57`).
- Provider IDs include `openai`, `openai-compatible`, `ollama`, `codex-cli`, and others (`apps/web/utils/llms/config.ts:1-17`; `docs/hosting/llm-setup.mdx:18-35`). `resolveApiKey()` precedence is user key, provider-specific env key, shared `LLM_API_KEY`, then `process.env.LLM_API_KEY` (`apps/web/utils/llms/model.ts:570-577`).
- The repo documents `codex-cli` and `claude-code` as experimental self-host options using third-party community AI SDK provider packages; they are disabled unless `CLI_LLM_ENABLED=true`, require review/pinning, and include a Codex example with `pnpm add ai-sdk-provider-codex-cli@1.1.0`, `pnpm add -g @openai/codex`, `codex login`, `DEFAULT_LLMS=codex-cli:gpt-5.3-codex` (`docs/hosting/llm-setup.mdx:92-121`).
- The implementation lazily imports `ai-sdk-provider-codex-cli`, calls `codexExec(modelName, { allowNpx, skipGitRepoCheck: true, approvalMode: "never", sandboxMode: "read-only", codexPath?, logger: false })`, and throws a safe error if the optional package is missing or lacks the expected export (`apps/web/utils/llms/cli-provider.ts:32-45`, `apps/web/utils/llms/cli-provider.ts:197-211`, `apps/web/utils/llms/cli-provider.ts:235-282`).
- Official OpenAI Codex docs distinguish Codex CLI product auth from general OpenAI API usage. This deployment intentionally uses the repo's experimental trusted self-host `codex-cli` path, so Codex auth/config must be treated as Kubernetes Secret material and the deployment should not be exposed as a public multi-tenant CLI execution service (https://developers.openai.com/codex/auth, https://developers.openai.com/codex/noninteractive, https://developers.openai.com/codex/enterprise/access-tokens; fetched 2026-06-30).

## Approach
Use the existing chart without template changes for the recommended production path. The work is primarily deployment contract, secret materialization, production values, identity/webhook setup, verification, and operations. The chart already exposes the needed extension points: `existingSecret`, `externalDatabase.existingSecret`, `externalRedis.existingSecret`, `env`, `extraEnv`, `extraEnvFrom`, `worker`, `cron`, `ingress`, and `migrations`.

The default production architecture assumes, unless the cluster conventions say otherwise:
- Helm release `inbox-zero` in namespace `inbox-zero`.
- Immutable image tag or digest from `ghcr.io/elie222/inbox-zero`, not `latest`.
- Managed Postgres, with the chart's external database wiring and migration hook.
- Managed Redis, with both BullMQ `REDIS_URL` and Upstash-compatible HTTP Redis values available.
- `QUEUE_BACKEND=bullmq`, `worker.enabled=true`, and CronJobs enabled.
- One HTTPS public hostname used consistently for ingress, `NEXT_PUBLIC_BASE_URL`, OAuth callbacks, and webhooks.
- Codex CLI for LLM calls: `DEFAULT_LLMS=codex-cli:gpt-5.3-codex`, `CLI_LLM_ENABLED=true`, a Codex-enabled image, and a Secret-mounted Codex auth/config directory.
- `NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED=true` only if the operator wants deployment-managed LLM settings and no per-account provider overrides.

The Codex CLI route is not just a Helm values change: it needs a Codex-enabled image, the `ai-sdk-provider-codex-cli` dependency, a Kubernetes Secret for Codex auth/config, a pod trust-boundary decision, and a documented rollback path.

## Work Items
### 1. Finalize The Deployment Contract
**Goal:** Lock the environment-specific constants for the Codex CLI deployment.

**Done when:** Namespace, release name, public hostname, ingress class, TLS issuer, image tag/digest policy, managed Postgres provider, managed Redis provider, secret-management mechanism, Redis HTTP strategy, AI model override policy, Codex CLI auth Secret name, and Codex-enabled image tag are recorded in the deployment runbook.

**Key files:** `docs/plans/kubernetes-codex-cli-llm-2026-06-30.md`, `charts/inbox-zero/values.yaml`.

**Dependencies:** None.

**Size:** S.

### 2. Pin And Verify The Production Image
**Goal:** Select an immutable production image instead of deploying `latest`.

**Done when:** Deployment values reference a tested image tag or digest, and the image is confirmed to contain both the standalone web runtime and worker runtime paths.

**Key files:** `docker/Dockerfile.prod`, `docker/scripts/start.sh`, `docker/scripts/start-worker.sh`, `charts/inbox-zero/values.yaml`.

**Dependencies:** Work item 1.

**Size:** S.

### 3. Provision Managed Postgres
**Goal:** Provide a production database with migration-safe connectivity.

**Done when:** Postgres exists, backups are enabled, a restore test is planned or completed, `DATABASE_URL` and `DIRECT_URL` are available, and migration connectivity from the cluster network is verified.

**Key files:** `charts/inbox-zero/templates/migration-job.yaml`, `charts/inbox-zero/templates/_helpers.tpl`, `docs/hosting/kubernetes.mdx`.

**Dependencies:** Work item 1.

**Size:** M.

### 4. Provision Managed Redis And Redis HTTP Compatibility
**Goal:** Provide Redis for BullMQ and app Redis/Upstash-compatible usage.

**Done when:** `REDIS_URL`, `UPSTASH_REDIS_URL`, and `UPSTASH_REDIS_TOKEN` are available in the target namespace, or the operator has decided which Redis HTTP bridge will run, where it will run, and whether any app features are blocked until it exists.

**Key files:** `charts/inbox-zero/templates/worker-deployment.yaml`, `apps/worker/src/runtime.mjs`, `docs/hosting/environment-variables.mdx`.

**Dependencies:** Work item 1.

**Size:** M.

### 5. Materialize Kubernetes Secrets
**Goal:** Make all required runtime secrets available according to the cluster's chosen secret-management mechanism.

**Done when:** Plain Kubernetes Secrets, ExternalSecrets, SealedSecrets, SOPS-managed manifests, or the cluster-standard equivalent produces `inbox-zero-database`, `inbox-zero-redis`, and `inbox-zero-secrets` in the target namespace with the expected keys. Provider-derived values may be added iteratively as OAuth, Pub/Sub, and Microsoft setup are completed.

**Key files:** `charts/inbox-zero/templates/secret.yaml`, `charts/inbox-zero/templates/_helpers.tpl`, `apps/web/env.ts`.

**Dependencies:** Work items 3 and 4.

**Size:** M.

The minimum keys are:
- `inbox-zero-database`: `DATABASE_URL`, `DIRECT_URL`.
- `inbox-zero-redis`: `REDIS_URL`, `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`.
- `inbox-zero-secrets`: `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_ENCRYPT_SECRET`, `EMAIL_ENCRYPT_SALT`, `INTERNAL_API_KEY`, `CRON_SECRET`, and `GOOGLE_PUBSUB_VERIFICATION_TOKEN`.
- `inbox-zero-codex-cli`: Codex CLI auth/config files such as `auth.json`, created from a local `codex login` and mounted through the chart's `codexCli.existingSecret`.

### 6. Prepare Production Helm Values
**Goal:** Produce a non-secret production values file for the deployment or infrastructure repo.

**Done when:** The values file sets external DB/Redis, disables bundled data stores, configures ingress/TLS, pins the image, enables BullMQ worker, enables migrations, sets `NEXT_PUBLIC_BASE_URL`, sets the chosen LLM env, and applies the AI model settings lock only if that policy is chosen.

**Key files:** `charts/inbox-zero/values.yaml`, `charts/inbox-zero/templates/configmap.yaml`, `charts/inbox-zero/templates/web-deployment.yaml`, `charts/inbox-zero/templates/worker-deployment.yaml`.

**Dependencies:** Work items 1, 2, and 5.

**Size:** M.

Core values should include:
```yaml
image:
  repository: ghcr.io/elie222/inbox-zero
  tag: <immutable-tag-or-digest>

existingSecret: inbox-zero-secrets

externalDatabase:
  enabled: true
  existingSecret:
    name: inbox-zero-database
postgresql:
  enabled: false

externalRedis:
  enabled: true
  existingSecret:
    name: inbox-zero-redis
redis:
  enabled: false
redisHttp:
  enabled: false

migrations:
  enabled: true
worker:
  enabled: true

env:
  NEXT_PUBLIC_BASE_URL: https://<production-host>
  QUEUE_BACKEND: bullmq
  DEFAULT_LLMS: codex-cli:gpt-5.3-codex
  # Set to "true" only when deployment-managed LLM settings should be mandatory.
  NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED: "true"
  GOOGLE_PUBSUB_TOPIC_NAME: projects/<project>/topics/<topic>
```

### 7. Configure Identity And Webhook Prerequisites
**Goal:** Ensure external providers target the final production URL.

**Done when:** Google OAuth redirect URLs, Gmail Pub/Sub topic/subscription, Pub/Sub verification token, and optional Microsoft OAuth/webhook settings match the production hostname. Pub/Sub resources may be pre-created, but final push subscription validation waits until public ingress and TLS are reachable.

**Key files:** `docs/hosting/environment-variables.mdx`, `docs/hosting/kubernetes.mdx`, `apps/web/env.ts`.

**Dependencies:** Work items 1 and 5.

**Size:** M.

### 8. Render, Lint, And Dry-Run Helm
**Goal:** Catch chart/value/secret wiring errors before creating workloads.

**Done when:** `helm lint`, `helm template`, and server-side dry-run succeed, and rendered resources show the expected web Deployment, migration Job, worker Deployment, CronJobs, Service, and Ingress.

**Key files:** `charts/inbox-zero/templates/*.yaml`, `charts/inbox-zero/values.yaml`.

**Dependencies:** Work item 6.

**Size:** S.

### 9. Install The Release And Run Migrations
**Goal:** Deploy Inbox Zero with external DB migration flow.

**Done when:** Helm install succeeds, the pre-install migration Job completes, web Deployment rolls out, and web pods include `SKIP_DB_MIGRATIONS=true`.

**Key files:** `charts/inbox-zero/templates/migration-job.yaml`, `charts/inbox-zero/templates/web-deployment.yaml`, `docker/scripts/start.sh`.

**Dependencies:** Work item 8.

**Size:** M.

### 10. Verify Web, Ingress, And Health
**Goal:** Confirm the app is reachable internally and externally.

**Done when:** `/api/health` succeeds through port-forward and public ingress, TLS is valid, and `NEXT_PUBLIC_BASE_URL` matches the public URL.

**Key files:** `charts/inbox-zero/templates/web-service.yaml`, `charts/inbox-zero/templates/ingress.yaml`, `apps/web/env.ts`.

**Dependencies:** Work item 9.

**Size:** S.

### 11. Verify Worker And Scheduled Jobs
**Goal:** Confirm background processing works.

**Done when:** Worker logs show subscribed queues, Redis connection succeeds, one test CronJob completes, and scheduled endpoint auth succeeds with `CRON_SECRET`.

**Key files:** `charts/inbox-zero/templates/worker-deployment.yaml`, `charts/inbox-zero/templates/cronjobs.yaml`, `apps/worker/src/runtime.mjs`.

**Dependencies:** Work items 9 and 10.

**Size:** M.

### 12. Verify OAuth, Webhooks, And Sign-In
**Goal:** Confirm user-facing account connection flows work.

**Done when:** A test user can sign in, connect Google, receive or watch mailbox updates, and webhook verification does not fail. Optional Microsoft flow is verified if enabled.

**Key files:** `apps/web/env.ts`, `docs/hosting/environment-variables.mdx`, `docs/hosting/kubernetes.mdx`.

**Dependencies:** Work items 7 and 10.

**Size:** M.

### 13. Verify The Codex CLI LLM Path
**Goal:** Confirm the production LLM path uses Codex CLI auth/config and not OpenAI API credentials.

**Done when:** A low-risk AI action succeeds, logs show provider `codex-cli`, account-level override behavior matches the chosen `NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED` policy, and missing/invalid Codex auth behavior is understood.

**Key files:** `apps/web/utils/llms/model.ts`, `apps/web/utils/llms/config.ts`, `docs/hosting/llm-setup.mdx`.

**Dependencies:** Work items 5, 6, and 10.

**Size:** S.

### 14. Harden The Codex CLI Runtime Boundary
**Goal:** Keep the `codex-cli` deployment bounded to a trusted personal self-host.

**Done when:** The operator explicitly accepts the risks, the Codex-enabled image is pinned, Codex auth is mounted as a Kubernetes Secret, `CLI_LLM_ENABLED=true` is isolated to the personal deployment, and rollback to a non-CLI provider is documented.

**Key files:** `apps/web/utils/llms/cli-provider.ts`, `apps/web/utils/llms/model.ts`, `docs/hosting/llm-setup.mdx`, `docker/Dockerfile.prod`.

**Dependencies:** Work item 1.

**Size:** L.

Acceptance constraints for this exception:
- Do not expose Codex execution to untrusted tenants or arbitrary prompts beyond this trusted personal deployment.
- Pin exact versions of the community provider package and Codex CLI.
- Mount Codex auth/config from Secret, never bake it into the image.
- Run with the repo's current `approvalMode: "never"` and `sandboxMode: "read-only"` behavior in mind.
- Keep non-CLI rollback values ready.

### 15. Operationalize Production
**Goal:** Make the deployment maintainable after launch.

**Done when:** Backup/restore test is complete, logs/alerts cover web/worker/migration/cron failures, resource requests are reviewed, secret rotation is documented, image upgrade process is documented, and rollback procedure is tested.

**Key files:** `charts/inbox-zero/values.yaml`, `charts/inbox-zero/templates/*.yaml`, `docs/hosting/kubernetes.mdx`.

**Dependencies:** Work items 9-13.

**Size:** L.

## Open Questions
- What are the actual cluster conventions: namespace, ingress controller/class, TLS issuer, secret-management mechanism, storage class, image registry policy, managed Postgres provider, managed Redis provider, and production domain?
- Should `NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED=true` be mandatory, or should trusted users be allowed to override AI providers in Settings -> AI?
- Does the managed Redis provider expose an Upstash-compatible HTTP endpoint, or does this deployment need a separate Redis HTTP bridge plan?

## References
- `docs/hosting/kubernetes.mdx`
- `docs/hosting/llm-setup.mdx`
- `docs/hosting/environment-variables.mdx`
- `charts/inbox-zero/README.md`
- `charts/inbox-zero/values.yaml`
- `apps/web/utils/llms/cli-provider.ts`
- `apps/web/utils/llms/model.ts`
- `apps/web/env.ts`
- `apps/worker/src/runtime.mjs`
- OpenAI Codex authentication: https://developers.openai.com/codex/auth
- OpenAI Codex non-interactive mode: https://developers.openai.com/codex/noninteractive
- OpenAI Codex access tokens: https://developers.openai.com/codex/enterprise/access-tokens

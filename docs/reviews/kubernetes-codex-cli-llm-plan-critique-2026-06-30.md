# Kubernetes + Codex CLI LLM Plan Critique

## Scope
Critique of `docs/plans/kubernetes-codex-cli-llm-2026-06-30.md` against the original context-builder export at `prompt-exports/oracle-plan-2026-06-30-171632-kubernetes-codex-pla-81b3.md`. This is intentionally narrow and does not expand implementation scope.

## Findings

### 1. Top 3 under-specified seams
1. **External secret mechanism is named but not sequenced.** Work item 1 says the external secret mechanism must be recorded, and work item 5 assumes Kubernetes Secrets already exist, but the plan never says whether the implementer should create plain Secrets, use External Secrets, SealedSecrets, SOPS, or another cluster convention (`docs/plans/kubernetes-codex-cli-llm-2026-06-30.md:42`, `:83-98`). This affects what gets committed and who owns secret materialization.
2. **Redis HTTP compatibility is a blocking decision without an owner.** The plan says `UPSTASH_REDIS_URL`/`UPSTASH_REDIS_TOKEN` must exist or a Redis HTTP bridge decision must be completed before Helm deployment (`docs/plans/kubernetes-codex-cli-llm-2026-06-30.md:72-77`), but it does not define how to evaluate provider support, where a bridge would run, or whether lack of HTTP compatibility blocks all deployment or only app features.
3. **Codex CLI exception path is intentionally deferred but not bounded enough for ordering.** Work item 14 requires a custom image/package/auth plan (`docs/plans/kubernetes-codex-cli-llm-2026-06-30.md:224-239`), but the open question asks whether the deployment should follow OpenAI API or Codex CLI (`:253-257`). If the answer is “Codex CLI first,” image selection, secret design, and verification order change before work item 2/5/13.

### 2. Specificity balance
- **Over-specified:** The plan hard-codes namespace/release `inbox-zero` in the default architecture (`docs/plans/kubernetes-codex-cli-llm-2026-06-30.md:26-27`) even though both the plan and export list namespace as an unresolved cluster convention (`docs/plans/...:253-254`; `prompt-exports/...:79-80`). Better as a default assumption, not a contract.
- **Over-specified:** `NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED=true` is treated as the sample value and a verification assertion (`docs/plans/...:139-144`, `:213-218`) while the export framed it as optional policy (“model settings lock if desired,” `prompt-exports/...:68-69`) and the plan itself leaves it open (`docs/plans/...:256`).
- **Dropped useful framing:** The export explicitly called out chart extension points (`existingSecret`, `externalDatabase.existingSecret`, `externalRedis.existingSecret`, `env`, `extraEnv`, `extraEnvFrom`, worker/cron/ingress/migrations) as the reason this is deployment/config rather than refactor work (`prompt-exports/...:172-173`). The final plan says “no template changes” but loses that practical escape hatch for cluster-specific integration.

### 3. Contradictions or missing dependencies
- Work item 6 depends on secrets (item 5), but identity/webhook provider setup (item 7) may be needed to know some secret values before item 5 is complete (`docs/plans/...:83-98`, `:147-156`). Consider making those iterative or explicitly allowing placeholder Secret creation.
- Work item 12 depends on item 7 and 10, but Google Pub/Sub may require public ingress verification before final webhook subscription validation (`docs/plans/...:202-207`). The current dependency is plausible, but the plan should state whether Pub/Sub can be pre-created before ingress is live.
- Work item 15 depends on items 9-13 (`docs/plans/...:242-250`), yet backup/restore policy appears earlier in Postgres provisioning (`:61-69`). Split “pre-launch backup/restore requirement” from post-launch operations or make item 3 depend on the operational decision.

### 4. Risk of over-planning
- The 15-work-item sequence is close to a runbook, but it still lacks cluster answers. Items 8-13 are mostly verification steps and could be collapsed into “preflight/deploy/smoke test” unless the implementer needs task-ticket granularity.
- The large background section is valuable for traceability, but for an implementation agent it may be longer than needed; keep only the deployment-critical facts and move source-heavy citations to references.

### 5. Questions that would change implementation order
1. Is the first target the recommended OpenAI API deployment, or must Codex CLI be supported before first launch?
2. Which secret-management mechanism is mandatory in the cluster?
3. Does the managed Redis provider supply Upstash-compatible HTTP endpoints, or is a bridge required?
4. Are namespace/release/ingress/TLS conventions already fixed, or should the implementer choose defaults?
5. Should account-level AI model overrides be disabled for this deployment?

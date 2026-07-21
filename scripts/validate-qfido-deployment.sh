#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'validation failed: %s\n' "$1" >&2
  exit 1
}

for required in \
  deploy/qfido/values.yaml \
  inventory/qfido-live-state-2026-07-21.yaml \
  docs/operations/qfido-kubernetes.md \
  docs/recovery/qfido-kubernetes.md \
  charts/inbox-zero/Chart.yaml; do
  [[ -f "$required" ]] || fail "missing $required"
done

helm lint charts/inbox-zero -f deploy/qfido/values.yaml
rendered="$(mktemp)"
trap 'rm -f "$rendered"' EXIT
helm template inbox-zero charts/inbox-zero --namespace inbox-zero -f deploy/qfido/values.yaml >"$rendered"

if grep -Eq '^kind:[[:space:]]*Secret[[:space:]]*$' "$rendered"; then
  fail "qFido overlay must not render a Kubernetes Secret"
fi

image_count="$(grep -Ec '^[[:space:]]*image:[[:space:]]+"?[^"[:space:]]+@sha256:[0-9a-f]{64}"?[[:space:]]*$' "$rendered" || true)"
[[ "$image_count" -gt 0 ]] || fail "rendered qFido images are not digest-pinned"
if grep -E '^[[:space:]]*image:[[:space:]]+"?[^"[:space:]]+:(latest|main)"?[[:space:]]*$' "$rendered"; then
  fail "mutable rendered image found"
fi

if grep -R -En '(/Users/|/home/[^/]+/|[A-Za-z]:\\Users\\)' \
  deploy/qfido inventory/qfido-live-state-2026-07-21.yaml \
  docs/operations/qfido-kubernetes.md docs/recovery/qfido-kubernetes.md; then
  fail "machine-specific absolute path found"
fi

if [[ "${SKIP_GITLEAKS:-0}" != "1" ]]; then
  command -v gitleaks >/dev/null || fail "gitleaks is required"
  for path in deploy/qfido inventory/qfido-live-state-2026-07-21.yaml docs/operations/qfido-kubernetes.md docs/recovery/qfido-kubernetes.md; do
    gitleaks dir --no-banner --redact --log-level warn "$path"
  done
fi

printf 'qFido deployment validation passed (%s digest-pinned image references)\n' "$image_count"

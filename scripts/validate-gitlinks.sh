#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

fail() {
  printf 'gitlink validation failed: %s\n' "$1" >&2
  exit 1
}

while IFS=$'\t' read -r metadata path; do
  mode="${metadata%% *}"
  [[ "$mode" == "160000" ]] || continue

  [[ -f .gitmodules ]] || fail "tracked gitlink '$path' has no .gitmodules file"

  path_key=""
  while IFS=' ' read -r key value; do
    if [[ "$value" == "$path" ]]; then
      [[ -z "$path_key" ]] || fail "tracked gitlink '$path' has duplicate .gitmodules path mappings"
      path_key="$key"
    fi
  done < <(git config --file .gitmodules --get-regexp '^submodule\..*\.path$' || true)

  [[ -n "$path_key" ]] || fail "tracked gitlink '$path' has no .gitmodules path mapping"

  url_key="${path_key%.path}.url"
  url="$(git config --file .gitmodules --get "$url_key" || true)"
  [[ -n "$url" ]] || fail "tracked gitlink '$path' has no .gitmodules URL"
done < <(git ls-files --stage)

printf 'gitlink validation passed\n'

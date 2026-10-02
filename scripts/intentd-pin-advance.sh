#!/usr/bin/env bash
# Positive proof for the auto-cut throttle exemption. Lookup failures return
# false; the caller retains its ordinary throttle/fail-open policy.
set -euo pipefail

[[ "${1:-}" == push ]] || exit 1
before=${2:-}
after=${3:-}
tag=${4:-}
[[ "$before" =~ ^[0-9a-f]{40}$ && "$before" != 0000000000000000000000000000000000000000 ]] || exit 1
[[ "$after" =~ ^[0-9a-f]{40}$ && "$after" != "$before" ]] || exit 1
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1

read_pin() {
  local pin
  pin=$(gh api "repos/$GITHUB_REPOSITORY/contents/intentd.version?ref=$1" \
    --jq '.content' 2>/dev/null | base64 -d \
    | grep -Ev '^[[:space:]]*(#|$)' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//') || return 1
  # Exactly one version line, using the same version shape as auto-pin.
  [[ "$pin" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || return 1
  printf '%s\n' "$pin"
}

newer_than() {
  # Same prerelease ordering as auto-pin-intentd and the in-flight guard.
  [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | tr '-' '~' | sort -V | tail -1)" == "${1//-/~}" ]]
}

old_pin=$(read_pin "$before") || exit 1
push_pin=$(read_pin "$after") || exit 1
newer_than "$push_pin" "$old_pin" || exit 1
released_pin=$(read_pin "tags/$tag") || exit 1
newer_than "$push_pin" "$released_pin" || exit 1
# Read main last: an older queued push must never exempt a superseding pin.
main_pin=$(read_pin heads/main) || exit 1
[[ "$main_pin" == "$push_pin" ]] || exit 1

echo "Confirmed intentd pin advance $old_pin → $push_pin; $tag still carries $released_pin."

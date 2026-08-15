#!/usr/bin/env bash
# Comment on monorepo issues whose fix is fully delivered by a release.
#
# Usage: notify-fixed-issues.sh [--dry-run] <component> <version> \
#          <from-ref> <to-ref> <bundled-intentd-version> [prev-intentd-version]
#
# Candidate collection: gathers ISSUES_REPO issue references
# (intent-hq/monorepo#N or the full issue URL) from
#   (a) commit messages in <from-ref>..<to-ref>, additionally resolving
#       squash-merge "(#N)" subject suffixes to PR bodies on SOURCE_REPO, and
#   (b) the bundled intentd delta v<prev-intentd>..v<bundled-intentd> via the
#       INTENTD_REPO compare API (this checkout has no intentd history), with
#       the same "(#N)" suffix resolution against INTENTD_REPO PR bodies.
#       Skipped when [prev-intentd-version] is absent or equal to the bundled
#       version.
#
# Completeness gate ("stay silent until complete"): each candidate issue's
# linked fix PRs are enumerated via GraphQL closedByPullRequestsReferences
# and filtered to SOURCE_REPO and INTENTD_REPO. The comment
#   "This fix is included in <component> vX.Y.Z (bundles intentd vA.B.C)."
# is posted only when no linked PR is open and every merged one's merge
# commit is contained in the released fe tag (SOURCE_REPO PRs) / the bundled
# intentd tag (INTENTD_REPO PRs). Containment uses the compare API:
# tag...sha status "identical" or "behind". An open or uncontained linked PR
# skips the issue (a later release picks it up); anything indeterminate (API
# error, a token that cannot see a repo's PRs) skips with a warning — never
# post a possibly-false claim. Issues with no linked fix PRs at all fall
# back to the range-scan evidence and are posted best-effort. Comments never
# name a channel.
#
# Idempotent: each comment embeds a hidden marker
# (<!-- release-notifier: <component> vX.Y.Z -->) and issues that already
# carry the marker are skipped, so tag rebuilds / workflow re-runs never
# double-post. With --dry-run, prints the issue list and comment bodies
# without posting (ISSUES_GH_TOKEN is then optional and the marker check is
# best-effort).
#
# This script is best-effort by design: its caller (release-beta.yml) runs it
# fail-soft so a notification failure never blocks a release.
# Requires: git (a checkout with full history for the fe range) and gh
# (authenticated via GH_TOKEN for the SOURCE_REPO reads).
#
# Env:
#   SOURCE_REPO       repo the fe range's PRs live on
#                     (default: intent-hq/cloudlands-fe)
#   INTENTD_REPO      repo of the bundled intentd delta
#                     (default: intent-hq/intentd)
#   ISSUES_REPO       repo whose issues are commented on
#                     (default: intent-hq/monorepo)
#   ISSUES_GH_TOKEN   token with issues:write on ISSUES_REPO; required unless
#                     --dry-run. Also runs the linked-PR enumeration, so it
#                     must be able to read PRs on SOURCE_REPO and
#                     INTENTD_REPO — visibility is probed up front and the
#                     gate skips everything with a warning when a probe
#                     fails. Falls back to ambient gh auth when unset.
#   INTENTD_GH_TOKEN  token that can read INTENTD_REPO (compare API + PR
#                     bodies); falls back to ambient gh auth when unset.
set -euo pipefail

# Callers run this script fail-soft (continue-on-error), so an unexpected
# set -e exit would otherwise be invisible (intent-hq/monorepo#1921). Log
# where it died before the shell unwinds — as a ::error:: annotation under
# GitHub Actions so it surfaces without opening the step log. -o errtrace
# propagates the trap into functions and subshells.
set -o errtrace
on_err() {
  local msg="notify-fixed-issues.sh: command failed (exit $1) at line $2: $3"
  echo "error: $msg" >&2
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::error::$msg"
  fi
}
trap 'on_err "$?" "$LINENO" "$BASH_COMMAND"' ERR

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

usage="usage: notify-fixed-issues.sh [--dry-run] <component> <version> <from-ref> <to-ref> <bundled-intentd-version> [prev-intentd-version]"
COMPONENT="${1:?$usage}"
VERSION="${2:?$usage}"
FROM_REF="${3:?$usage}"
TO_REF="${4:?$usage}"
BUNDLED_INTENTD="${5:?$usage}"
PREV_INTENTD="${6:-}"
SOURCE_REPO="${SOURCE_REPO:-intent-hq/cloudlands-fe}"
INTENTD_REPO="${INTENTD_REPO:-intent-hq/intentd}"
ISSUES_REPO="${ISSUES_REPO:-intent-hq/monorepo}"
ISSUES_GH_TOKEN="${ISSUES_GH_TOKEN:-}"
INTENTD_GH_TOKEN="${INTENTD_GH_TOKEN:-}"

VERSION="${VERSION#v}"
BUNDLED_INTENTD="${BUNDLED_INTENTD#v}"
PREV_INTENTD="${PREV_INTENTD#v}"

# Validate before echoing anything (workflow-command / log injection).
semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
if [[ ! "$COMPONENT" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "error: component must match ^[A-Za-z0-9._-]+\$" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ $semver_re ]]; then
  echo "error: version must look like [v]X.Y.Z[-<prerelease>] (prerelease limited to [0-9A-Za-z.-])" >&2
  exit 1
fi
if [[ ! "$BUNDLED_INTENTD" =~ $semver_re ]]; then
  echo "error: bundled-intentd-version must look like [v]A.B.C[-<prerelease>] (prerelease limited to [0-9A-Za-z.-])" >&2
  exit 1
fi
if [[ -n "$PREV_INTENTD" && ! "$PREV_INTENTD" =~ $semver_re ]]; then
  echo "error: prev-intentd-version must look like [v]A.B.C[-<prerelease>] (prerelease limited to [0-9A-Za-z.-])" >&2
  exit 1
fi
repo_name_re='^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'
if [[ ! "$SOURCE_REPO" =~ $repo_name_re || ! "$INTENTD_REPO" =~ $repo_name_re || ! "$ISSUES_REPO" =~ $repo_name_re ]]; then
  echo "error: SOURCE_REPO, INTENTD_REPO, and ISSUES_REPO must be owner/repo" >&2
  exit 1
fi
if [[ "$DRY_RUN" == false && -z "$ISSUES_GH_TOKEN" ]]; then
  echo "error: ISSUES_GH_TOKEN must be set (issues:write on $ISSUES_REPO) unless --dry-run" >&2
  exit 1
fi
for ref in "$FROM_REF" "$TO_REF"; do
  if ! git rev-parse -q --verify "${ref}^{commit}" >/dev/null; then
    echo "error: ref not found in this checkout: $ref" >&2
    exit 1
  fi
done

# gh invocations against ISSUES_REPO use ISSUES_GH_TOKEN when set; dry-runs
# without it fall back to whatever auth gh already has.
gh_issues() {
  if [[ -n "$ISSUES_GH_TOKEN" ]]; then
    GH_TOKEN="$ISSUES_GH_TOKEN" gh "$@"
  else
    gh "$@"
  fi
}

# gh invocations against INTENTD_REPO (private) use INTENTD_GH_TOKEN when
# set; falls back to whatever auth gh already has.
gh_intentd() {
  if [[ -n "$INTENTD_GH_TOKEN" ]]; then
    GH_TOKEN="$INTENTD_GH_TOKEN" gh "$@"
  else
    gh "$@"
  fi
}

range="${FROM_REF}..${TO_REF}"
issues_repo_re=${ISSUES_REPO//./\\.}
issue_ref_re="(${issues_repo_re}#|https://github\\.com/${issues_repo_re}/issues/)[0-9]+"

refs_file=$(mktemp)
trap 'rm -f "$refs_file"' EXIT

# (a) direct references in fe commit messages in the range.
messages=$(git log --format=%B "$range")
grep -oE "$issue_ref_re" <<<"$messages" >>"$refs_file" || true

# (b) squash-merge "(#N)" subject suffixes -> PR bodies. A suffix that does
# not resolve to a PR (or an API hiccup) is skipped with a warning: direct
# commit-message references still work and callers run fail-soft anyway.
subjects=$(git log --format=%s "$range")
pr_nums=$(grep -oE '\(#[0-9]+\)$' <<<"$subjects" | grep -oE '[0-9]+' | sort -un || true)
while IFS= read -r pr; do
  [[ -n "$pr" ]] || continue
  if body=$(gh pr view "$pr" --repo "$SOURCE_REPO" --json body --jq '.body // ""' 2>/dev/null); then
    grep -oE "$issue_ref_re" <<<"$body" >>"$refs_file" || true
  else
    echo "warning: could not read PR #$pr on $SOURCE_REPO; skipping its body" >&2
  fi
done <<<"$pr_nums"

# (c) the bundled intentd delta, via the compare API (this checkout has no
# intentd history): commit messages plus "(#N)" suffixes -> INTENTD_REPO PR
# bodies. Failures here only lose candidates (warn + continue) — they can
# never cause an over-claim.
if [[ -z "$PREV_INTENTD" ]]; then
  echo "no previous intentd pin given; skipping the intentd delta scan" >&2
elif [[ "$PREV_INTENTD" == "$BUNDLED_INTENTD" ]]; then
  echo "intentd pin unchanged (v${BUNDLED_INTENTD}); skipping the intentd delta scan" >&2
else
  intentd_range="v${PREV_INTENTD}...v${BUNDLED_INTENTD}"
  if intentd_messages=$(gh_intentd api "repos/${INTENTD_REPO}/compare/${intentd_range}" \
    --paginate --jq '.commits[].commit.message' 2>/dev/null); then
    grep -oE "$issue_ref_re" <<<"$intentd_messages" >>"$refs_file" || true
    intentd_subjects=$(gh_intentd api "repos/${INTENTD_REPO}/compare/${intentd_range}" \
      --paginate --jq '.commits[].commit.message | split("\n")[0]' 2>/dev/null || true)
    intentd_pr_nums=$(grep -oE '\(#[0-9]+\)$' <<<"$intentd_subjects" | grep -oE '[0-9]+' | sort -un || true)
    while IFS= read -r pr; do
      [[ -n "$pr" ]] || continue
      if body=$(gh_intentd pr view "$pr" --repo "$INTENTD_REPO" --json body --jq '.body // ""' 2>/dev/null); then
        grep -oE "$issue_ref_re" <<<"$body" >>"$refs_file" || true
      else
        echo "warning: could not read PR #$pr on $INTENTD_REPO; skipping its body" >&2
      fi
    done <<<"$intentd_pr_nums"
  else
    echo "warning: could not read the intentd delta ${intentd_range} on $INTENTD_REPO; its candidates are lost (fe-range candidates still processed)" >&2
  fi
fi

issue_nums=$(grep -oE '[0-9]+$' "$refs_file" | sort -un || true)
if [[ -z "$issue_nums" ]]; then
  echo "no $ISSUES_REPO issue references found in $range or the intentd delta; nothing to do" >&2
  exit 0
fi
echo "candidate issues: $(tr '\n' ' ' <<<"$issue_nums")" >&2

# The GraphQL linked-PR enumeration below silently omits PRs in repos its
# token cannot see, which would defeat the completeness gate (INTENTD_REPO is
# private). Probe PR visibility up front with the same token: on failure
# every candidate is indeterminate, so nothing is posted.
probe_failed=""
for repo in "$SOURCE_REPO" "$INTENTD_REPO"; do
  if ! gh_issues api "repos/${repo}/pulls?state=all&per_page=1" --silent 2>/dev/null; then
    probe_failed="${probe_failed:+$probe_failed, }$repo"
  fi
done
if [[ -n "$probe_failed" ]]; then
  probe_msg="notify-fixed-issues.sh: the issues token cannot list pull requests on: ${probe_failed}. Linked-PR completeness cannot be verified, so no comment is posted — grant the token (MONOREPO_ISSUES_TOKEN) read access to Pull requests on the repo(s)."
  echo "warning: $probe_msg" >&2
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::warning::$probe_msg"
  fi
  exit 0
fi

# Completeness gate: enumerate the issue's linked fix PRs (closing-keyword
# references, e.g. "Fixes intent-hq/monorepo#N") and require every one to be
# delivered by this release. Sets gate_result to "post" (all linked PRs
# merged and contained, or no linked PRs at all -> range-scan fallback),
# "incomplete" (an open or not-yet-contained linked PR), or "indeterminate"
# (an API failure); gate_detail carries the reason.
# shellcheck disable=SC2016  # $owner/$repo/$number are GraphQL variables
gate_query='query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$number){
      closedByPullRequestsReferences(first:100,includeClosedPrs:true){
        nodes{number state merged mergeCommit{oid} repository{nameWithOwner}}
      }
    }
  }
}'

# compare_status <repo> <tag> <sha>: compare API status for tag...sha
# ("identical"/"behind" means sha is contained in tag).
compare_status() {
  if [[ "$1" == "$INTENTD_REPO" ]]; then
    gh_intentd api "repos/$1/compare/$2...$3" --jq .status 2>/dev/null
  else
    gh api "repos/$1/compare/$2...$3" --jq .status 2>/dev/null
  fi
}

check_issue_completeness() {
  local n="$1" nodes repo pr state merged sha tag status linked=0
  gate_result="indeterminate"
  gate_detail=""
  if ! nodes=$(gh_issues api graphql \
    -f query="$gate_query" \
    -f owner="${ISSUES_REPO%%/*}" -f repo="${ISSUES_REPO##*/}" -F number="$n" \
    --jq '.data.repository.issue.closedByPullRequestsReferences.nodes[] | [.repository.nameWithOwner, (.number|tostring), .state, (.merged|tostring), (.mergeCommit.oid // "")] | @tsv' 2>/dev/null); then
    gate_detail="could not enumerate linked fix PRs on $ISSUES_REPO#$n"
    return 0
  fi
  while IFS=$'\t' read -r repo pr state merged sha; do
    [[ -n "$repo" ]] || continue
    case "$repo" in
      "$SOURCE_REPO") tag="$TO_REF" ;;
      "$INTENTD_REPO") tag="v${BUNDLED_INTENTD}" ;;
      *) continue ;; # PRs in other repos are outside this gate's scope
    esac
    linked=$((linked + 1))
    if [[ "$state" == "OPEN" ]]; then
      gate_result="incomplete"
      gate_detail="$repo#$pr is still open"
      return 0
    fi
    if [[ "$merged" != "true" ]]; then
      continue # closed without merging: abandoned, not part of the fix
    fi
    if [[ -z "$sha" ]]; then
      gate_detail="$repo#$pr has no recorded merge commit"
      return 0
    fi
    if ! status=$(compare_status "$repo" "$tag" "$sha"); then
      gate_detail="could not check $repo#$pr containment in $tag"
      return 0
    fi
    if [[ "$status" != "identical" && "$status" != "behind" ]]; then
      gate_result="incomplete"
      gate_detail="$repo#$pr is not contained in $tag (compare status: $status)"
      return 0
    fi
  done <<<"$nodes"
  gate_result="post"
  if [[ "$linked" -eq 0 ]]; then
    gate_detail="no linked fix PRs; falling back to range-scan evidence"
  else
    gate_detail="all $linked linked fix PR(s) merged and contained"
  fi
}

marker="<!-- release-notifier: ${COMPONENT} v${VERSION} -->"
message="This fix is included in ${COMPONENT} v${VERSION} (bundles intentd v${BUNDLED_INTENTD})."
comment_body="${message}
${marker}"

posted=0
skipped=0
gated=0
failed=0
while IFS= read -r n; do
  [[ -n "$n" ]] || continue
  check_issue_completeness "$n"
  if [[ "$gate_result" == "indeterminate" ]]; then
    echo "warning: issue #$n: completeness is indeterminate (${gate_detail}); skipping to avoid a possibly-false claim" >&2
    gated=$((gated + 1))
    continue
  fi
  if [[ "$gate_result" == "incomplete" ]]; then
    echo "issue #$n: fix is not fully delivered by this release (${gate_detail}); skipping — a later release picks it up" >&2
    gated=$((gated + 1))
    continue
  fi
  echo "issue #$n: completeness gate passed (${gate_detail})" >&2
  # Idempotency: skip issues that already carry the marker for this
  # component+version.
  if existing=$(gh_issues api "repos/${ISSUES_REPO}/issues/${n}/comments" \
    --paginate --jq '.[].body' 2>/dev/null); then
    if grep -qF "$marker" <<<"$existing"; then
      echo "issue #$n: already notified for ${COMPONENT} v${VERSION}; skipping" >&2
      skipped=$((skipped + 1))
      continue
    fi
  elif [[ "$DRY_RUN" == true ]]; then
    echo "warning: issue #$n: could not read existing comments (marker check skipped in dry-run)" >&2
  else
    echo "warning: issue #$n: could not read existing comments; skipping to avoid double-posting" >&2
    failed=1
    continue
  fi
  if [[ "$DRY_RUN" == true ]]; then
    echo "--- would comment on ${ISSUES_REPO}#${n}: ---"
    printf '%s\n' "$comment_body"
  elif gh_issues issue comment "$n" --repo "$ISSUES_REPO" --body "$comment_body" >/dev/null; then
    echo "issue #$n: commented (${COMPONENT} v${VERSION})" >&2
    posted=$((posted + 1))
  else
    echo "warning: issue #$n: failed to post comment" >&2
    failed=1
  fi
done <<<"$issue_nums"

if [[ "$DRY_RUN" == true ]]; then
  echo "dry-run: nothing posted (gate skipped $gated, already-notified $skipped)" >&2
else
  echo "posted $posted comment(s), gate skipped $gated, already-notified $skipped" >&2
fi
if [[ "$failed" -ne 0 ]]; then
  echo "error: one or more notifications failed" >&2
  exit 1
fi

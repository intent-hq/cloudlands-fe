#!/usr/bin/env bash
# Network git for CI with bounded retries on transient network errors
# (intent-hq/intent#8783: merge-queue runs were ejected when github.com dropped
# a connection during a fixture checkout or a baseline fetch). Any other
# failure, such as a missing ref, a missing commit or an auth error, fails at
# once.
#
#   git-network-retry.sh run <git args...>
#   git-network-retry.sh sparse-checkout <repository-url> <ref> <path>
#       Non-cone patterns on stdin. Replaces <path> with a detached, depth-1,
#       blob:none checkout of <ref> (a branch, tag or full commit SHA).
#
# GIT_RETRY_ATTEMPTS (default 4) caps the attempts; GIT_RETRY_DELAYS lists the
# seconds to wait before each retry (default "15 30 60"; the last value
# repeats). GIT_RETRY_GIT overrides the git command (tests).
set -euo pipefail

attempts=${GIT_RETRY_ATTEMPTS:-4}
read -r -a delays <<< "${GIT_RETRY_DELAYS:-15 30 60}"
git_bin=${GIT_RETRY_GIT:-git}

# Errors from git, curl and TLS that mean the remote could not be reached or
# dropped the connection; none of them can come from a bad ref or bad auth.
transient='Failed to connect to|Could not resolve host|Connection timed out|Operation timed out|Connection reset|Connection refused|Empty reply from server|Recv failure|The remote end hung up unexpectedly|early EOF|RPC failed|unexpected disconnect|HTTP/2 stream|returned error: (429|5[0-9][0-9])|gnutls_handshake|TLS connection was non-properly terminated|SSL_ERROR_SYSCALL|SSL connection timeout'

# Errors that name a real problem; they win over the transient list because
# git can follow them with a generic "remote end hung up".
permanent="not our ref|couldn't find remote ref|unadvertised object|Repository not found|Authentication failed|returned error: 40[0-9]|could not read Username|invalid refspec"

usage() {
  echo "usage: $0 run <git args...> | sparse-checkout <repository-url> <ref> <path>" >&2
  exit 2
}

retry_git() {
  local attempt=1 rc delay err
  err=$(mktemp)
  while :; do
    echo "git $* (attempt $attempt/$attempts)" >&2
    rc=0
    "$git_bin" "$@" 2>"$err" || rc=$?
    cat "$err" >&2
    if [ "$rc" -eq 0 ]; then
      rm -f "$err"
      return 0
    fi
    if grep -Eqi "$permanent" "$err" || ! grep -Eqi "$transient" "$err"; then
      rm -f "$err"
      echo "::error::git $* failed (exit $rc): not a transient network error, so not retried." >&2
      return "$rc"
    fi
    if [ "$attempt" -ge "$attempts" ]; then
      rm -f "$err"
      echo "::error::git $* failed (exit $rc) after $attempts attempts: github.com stayed unreachable (intent-hq/intent#8783)." >&2
      return "$rc"
    fi
    delay=${delays[$(( attempt <= ${#delays[@]} ? attempt - 1 : ${#delays[@]} - 1 ))]}
    echo "::warning::git $* hit a transient network error (attempt $attempt/$attempts, exit $rc); retrying in ${delay}s." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

sparse_checkout() {
  if [ "$#" -ne 3 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then usage; fi
  local url=$1 ref=$2 dest=$3 patterns
  patterns=$(grep -v '^[[:space:]]*$' || true)
  if [ -z "$patterns" ]; then
    echo "::error::no sparse-checkout patterns on stdin for $url@$ref." >&2
    exit 2
  fi
  rm -rf "$dest"
  "$git_bin" -c init.defaultBranch=main init -q "$dest"
  "$git_bin" -C "$dest" remote add origin "$url"
  printf '%s\n' "$patterns" | "$git_bin" -C "$dest" sparse-checkout set --no-cone --stdin
  retry_git -C "$dest" fetch --no-tags --depth=1 --filter=blob:none origin "$ref"
  # blob:none defers the file downloads to checkout, so it needs retries too.
  retry_git -C "$dest" checkout --quiet --force --detach FETCH_HEAD
  echo "Checked out $url@$("$git_bin" -C "$dest" rev-parse HEAD) into $dest"
}

[ "$#" -ge 1 ] || usage
command=$1
shift
case "$command" in
  run)
    [ "$#" -ge 1 ] || usage
    retry_git "$@"
    ;;
  sparse-checkout) sparse_checkout "$@" ;;
  *) usage ;;
esac

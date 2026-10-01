#!/usr/bin/env bash
# Materialized future recipe only. Requires separately reviewed execution-grant bytes.
set -euo pipefail
test "$#" -eq 3
source_sha="$1"; grant_file="$2"; grant_sha="$3"
test "$(git rev-parse HEAD)" = "$source_sha"
test -z "$(git status --porcelain)"
test "$(sha256sum "$grant_file" | cut -d' ' -f1)" = "$grant_sha"
test "${GITHUB_RUN_ATTEMPT:-}" = 1
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${RUNNER_ARCH:-}" = X64
image='mcr.microsoft.com/playwright@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac'
phase_root="$(mktemp -d "${RUNNER_TEMP:?}/member-controls.XXXXXXXX")"
chmod 700 "$phase_root"
mkdir -m 700 "$phase_root/repo" "$phase_root/inputs" "$phase_root/evidence"
git archive "$source_sha" | tar -x -C "$phase_root/repo"
cp -- "$grant_file" "$phase_root/inputs/execution-grant.json"
printf '%s\n' "$source_sha" > "$phase_root/evidence/source-sha.txt"
container_id=''; setup_id=''
cleanup() {
  status="$?"
  trap - EXIT INT TERM
  for owned_id in "$container_id" "$setup_id"; do
    if test -n "$owned_id"; then
      docker inspect "$owned_id" > "$phase_root/evidence/container-$owned_id-before-release.json" || status=1
      docker rm -f "$owned_id" > "$phase_root/evidence/container-$owned_id-release.txt" 2>&1 || status=1
      if docker inspect "$owned_id" > /dev/null 2>&1; then status=1; fi
    fi
  done
  # Only sanitized workload evidence and container metadata leave the job.
  mkdir -p member-controls-evidence
  cp -a "$phase_root/evidence/." member-controls-evidence/
  printf '%s\n' "$status" > member-controls-evidence/terminal-exit.txt
  # State/tokens/profile reside only in container tmpfs; remove setup inputs too.
  rm -rf -- "$phase_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker pull --platform linux/amd64 "$image"
docker image inspect "$image" > "$phase_root/evidence/image.json"
# Acquisition on the hosted VM; workload never receives GITHUB_TOKEN.
node tests/member-controls/acquire.mjs "$phase_root/inputs/candidate"
python3 tests/member-controls/extract.py "$phase_root/inputs/candidate"
cp "$phase_root/inputs/candidate/binary.json" "$phase_root/evidence/candidate.json"
setup_id="$(docker create --platform linux/amd64 --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --network bridge \
  --mount "type=bind,src=$phase_root/repo,dst=/repo" --workdir /repo --env HOME=/tmp/setup-home --tmpfs /tmp:rw,nosuid,nodev,size=2g \
  "$image" /bin/bash -euc 'mkdir -p /tmp/setup-home; npm install --ignore-scripts --prefix /tmp/tools pnpm@10.30.3; export PATH=/tmp/tools/node_modules/.bin:$PATH; pnpm install --frozen-lockfile --ignore-scripts; pnpm build:web; node --version; pnpm --version')"
docker start -a "$setup_id" > "$phase_root/evidence/setup.txt" 2>&1
test "$(docker inspect -f '{{.State.ExitCode}}' "$setup_id")" = 0
# Workload: no credentials, host PID/IPC/network, devices, host sockets, or published ports.
container_id="$(docker create --platform linux/amd64 --user "$(id -u):$(id -g)" --init --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 1024 --memory 12g --cpus 4 --shm-size 1g \
  --tmpfs /work:rw,nosuid,nodev,mode=1777,size=8g --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=2g \
  --mount "type=bind,src=$phase_root/repo,dst=/repo,readonly" --mount "type=bind,src=$phase_root/inputs,dst=/inputs,readonly" \
  --mount "type=bind,src=$phase_root/evidence,dst=/evidence" --workdir /repo \
  "$image" /usr/bin/env -i PATH=/usr/bin:/bin PLAYWRIGHT_BROWSERS_PATH=/ms-playwright LC_ALL=C \
  node tests/member-controls/run.mjs "$grant_sha" "$source_sha")"
docker inspect "$container_id" > "$phase_root/evidence/workload-created.json"
# Container-only wait. Status 124/137/cancellation remains failure, never a successful scene.
timeout --signal=TERM --kill-after=30s 1800s docker start -a "$container_id" > "$phase_root/evidence/workload-output.txt" 2>&1
test "$(docker inspect -f '{{.State.ExitCode}}' "$container_id")" = 0

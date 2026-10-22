# Disposable member-controls verification (disabled)

These are newly authored fixtures for a new test route. They do not recover the
missing historical frontend or fixture sources, and they carry no prior runtime
approval. `plan.json` and the workflow keep every readiness/authorization flag
false. No candidate, browser, TLS fixture, container, or workflow was run during
source preparation. The pure Vitest contract tests construct inert socket
objects; they do not establish transport behavior.

The frontend lineage is retained PR source `22a5e25b92f635bef9c82849edd93b479e28e133`
merged with captured main `a841080163dcd70f2a3d98b10f3a37c16e0a9359`. The committed
source SHA, tree, ordered parents, conflict map, full patches, bundle, source
archive and local command receipts accompany the source-review handoff. There
is no transfer of the old `6df` source, gate or runtime approval.

## Inputs and separate authorization

The candidate is NEW intentd 0.9.113, source/tag commit
`f0fcfce7b9d97cec6a561533b65ba9571e9d4db7`, release 397705604, asset 593211424.
`acquire.mjs` requires the release/tag/asset metadata, 27,088,520-byte size and
published SHA-256 `40174e11f1a85ddb6c4f41d5395c0b74a513636472c8c5f7b64d637624457430`
together before retaining the archive. `extract.py` rejects unsafe archive
members, accepts one regular x86-64 ELF, rejects an interpreter, DT_NEEDED and
RPATH/RUNPATH, and records/rechecks the extracted digest, size and mode without
executing it. A mismatch requires another disposition, not a different artifact.
This is a future route; the bytes and ABI are not verified in this preparation.

`plan.json` pins the official Playwright 1.62.1 Ubuntu Noble amd64 manifest by
digest. The retained registry index/manifest/config identify that image; no image
was pulled or its tools executed. The repository lock binds Playwright and other
dependencies. Setup uses pnpm 10.30.3 with frozen lockfile and installation
scripts disabled; the future setup records actual tool versions. Missing or
incompatible tools stop setup. There is no self-hosted or shared-host fallback.

A later reviewed workflow change must enable the disabled job. Its separate
`grant_json` input, at most 8 KiB, is written exclusively outside the checkout,
hashed against `grant_sha256`, and binds these required fields:

```json
{
  "hostedExecutionAuthorized": true,
  "attempt": 1,
  "sourceSha": "<exact reviewed source commit>",
  "image": "<exact plan.json image digest>",
  "candidateSha256": "<exact plan.json archive digest>"
}
```

This example is a schema, not an actual grant. No grant or attempt marker exists
in this source. Source hashes do not include their own grant. Future entrypoint:
`bash tests/member-controls/hosted.sh "$SOURCE_SHA" "$GRANT_FILE" "$GRANT_SHA256"`.
The script requires a clean exact checkout, GitHub-hosted X64 runner and run
attempt 1. It records source, image, candidate, setup and exact container identity.

## Workload and evidence

`hosted.sh` separates networked setup from the network-disabled workload. Both
containers are non-root with capabilities dropped and no new privileges. The
workload receives read-only source and candidate, fresh private writable tmpfs,
and its evidence directory. It receives no setup token, host socket, published
port, device, host PID/IPC namespace or shared cache. It has 12 GiB memory, four
CPUs, 1,024 tasks, a 30-minute outer timeout and an internal first-failure route.
The job is limited to 90 minutes with the main step limited to 80, reserving ten
minutes for cleanup/artifact upload. This is configured intent, not observed
runner isolation or cleanup proof.

`run.mjs` creates fresh daemon state and discovers its private listener. The
owner UDS is used only for listener metadata. `wire.mjs` pins the actual TLS
certificate before RPC and retains real request/response hashes, request IDs and
socket IDs. The synthetic public forge serves nonce proofs; only the daemon may
mint the role credentials. Each renderer gets a fresh browser context and a
role-bound loopback bridge. There is no principal, capability, preference or RPC
result injection. `mock-acp.mjs` is explicitly a synthetic deterministic reply
provider, not proof of a real provider or the historical MCP session predicate.

Readiness requires the app shell, a real browser `principal.me` for that role and
a trial actionability check on the existing Settings control. The original
Ctrl+K action is then used once. Readiness does not await a deliberately held
GitLab status. Action locators retain 15 seconds; readiness/status retain 30.
The labels/selectors are tied to the current source, but remain runtime-unverified.

`owned.mjs` records child PID/start, two nonempty owned-tree captures and
inode-bound listener ownership. The first post-create audit precedes Share or
scenes; another audit is required after all valid scenes. Absence of descendants
is separate from the still-running collector; the outer container wait/removal
receipt must establish collector termination. Identity mismatches receive no
signal. Failed release is retained. Profiles/tokens are container tmpfs only.

The first failure stops the sequence. Per-scene screenshots, bounded ARIA,
target identity, page errors, wire hashes and owned cleanup are saved. URL query
and fragment capabilities and secret fields are redacted from text; invite URL
controls are masked in screenshots. Raw daemon/provider output is not published;
chunk hashes/counts are retained. Failed or unexercised checks cannot be success.
The original response hold forwards bytes only to its original still-open socket;
closed-origin discard proves transport isolation, not delivered-stale saga behavior.

## Acceptance coverage and remaining oracles

| Obligation                                                              | New source and future evidence                                                                          | Remaining limit                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh member/guest/owner admission                                      | `run.mjs` invite challenge/prove, TLS principal read, fresh contexts                                    | Offline host-invite issuance may require a rendezvous address; current source refuses tunnel-down and stops. No fake Tailcat advertisement or token/DB substitution is supplied. This prerequisite needs a separate disposition before execution. |
| Normal empty-host member New/default path/durable workspace+agent/reply | `ordinaryCreate`, real create/list reply IDs, actual returned route, synthetic ACP reply                | Candidate mock compatibility and selectors unrun; source compatibility deltas are not runtime proof.                                                                                                                                              |
| First post-create listener/process proof                                | `audit` → `Owned.proof` immediately after New                                                           | New collector semantics require review; historical MCP predicate/session and PTY-containment evidence do not transfer.                                                                                                                            |
| Account-free Share guest grant/readback                                 | `directShareGuest`, ordinary existing-user selector then actual member roster/guest workspace read      | Requires real bootstrap guest; no external lookup or invite mint success is implied.                                                                                                                                                              |
| 1 Pending canonical pin, unpinned availability                          | `runScenes` pending-canonical-pin                                                                       | Hidden nonempty pin is explicitly unexercised; it is never fabricated.                                                                                                                                                                            |
| 2 Cold owner canonical GitLab before Connections                        | owner hold armed before page admission, original-socket release, canonical real response                | The server response oracle is complete; UI consumption without an ordinary visible canonical field remains limited.                                                                                                                               |
| 3 Status-only boot and lab order                                        | owner admission response count, ordinary lab enable/disable, account-action refusal                     | No credential, Connect, revoke/cancel or grant-resume action is permitted.                                                                                                                                                                        |
| 4 Held status through disconnect/unknown/readmission                    | original-socket response held, disconnect, preserved route/withheld Share, fresh principal on reconnect | Closed discard is not delivery to a stale saga. Unit cancellation proof remains separate.                                                                                                                                                         |
| 5 Role/status/Share boundaries                                          | member/guest owner-status absence, current Share controls, real guest read                              | A retained-owner guest is covered by state tests, not this ordinary guest scene.                                                                                                                                                                  |
| 6 Open Share, GitLab off, local preference                              | ordinary palette while modal is open, final audit                                                       | Modal shortcut or hidden pin may refuse; local cross-role storage isolation and pin retention require actual reachable UI observations.                                                                                                           |

The three retained daemon source deltas (credential/attribution) remain questions
for actual TLS evidence. The missing old binary is not recovered by this candidate.
Electron/native dialogs, Devices/iOS, current installed daemon, old G0/TCGETS,
provider accounts, tunnels, and the other stopped lane are outside this route.
No task closure, publication or execution approval follows from source preparation.

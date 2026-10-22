# Isolated macOS test builds

The manual workflow's optional `isolated_test=true` input builds **Intent GitLab
Test**, a separate signed ARM64 application. It requires `build_macos=true`,
`sign=true`, `macos_arch=arm64`, an exact 40-character `intentd_ref`, and no other
platform selection. The normal package's `smoke_macos` journeys must remain off;
the separate test app uses its own `verify-isolated-macos` job.
It does not change the normal app or its pinned sidecar.

The workflow compiles its run/attempt identity and resolved backend commit into
the application. Launch-time environment variables cannot enable or disable the
profile. Both processes use a private directory under
`~/.intent-tests/manual-<run-id>-<attempt>/`: desktop/session state, daemon database,
socket, lock, PID, configuration, workspaces, secrets and temporary files.
Legacy imports, shared Keychain synchronization, the `intent://` protocol,
system CLI installation/repair, app and daemon updates, remote pairing and
external backend transports are disabled. Invitation links are refused before
connection or credential work, including explicitly delivered links. The test
app uses its bundled daemon through its private Unix socket.

The backend must implement the immutable process-start
`INTENTD_PRIVATE_TEST_PROFILE=1` policy and installed GitHub CLI credential
suppression; every initial and recovery launch also receives
`INTENTD_DISABLE_GH_CREDENTIALS=1`. The policy pins loopback, disables the WS API,
tunnel, idle updates and Git credential exposure to children, requires TLS and
authentication, and rejects insecure startup. Mutable private preferences remain
usable; settings updates, reset and configuration reload cannot remove those
pins. Neither a private HOME nor a GitHub config directory alone provides this
credential boundary.

An occupied socket, unsafe linked/shared directory, or profile marked for a
different backend build fails closed. Close the previous instance before
relaunching. Do not repoint a normal installation at this directory or reuse
its database with another daemon version. Each workflow attempt gets a new
profile. User-selected repositories and provider actions still have their
ordinary effects; use disposable test repositories and accounts.

Delivery requires the `verify-isolated-macos` job to pass on a fresh
[GitHub-hosted macOS VM](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It checks the actual signed/notarized package and architecture; original hello,
capabilities and frontend/backend identities at each lifecycle phase;
private startup, recovery and relaunch; disabled shared actions; preserved normal
database/profile/secret/CLI sentinels; no connection to the normal socket; and
explicit original sidecar stop/exit receipts followed by joined Electron exits.
Subsequent PID absence is recorded separately, not treated as an exit receipt.
This does not exercise every ordinary quit-dialog path. Its
`isolated-macos-proof-arm64` artifact and the DMG have seven-day
retention. A source check, renamed bundle, successful build, or Linux unit test
alone does not establish packaged isolation.

The ordinary manual installer remains unsuitable for unshipped SQLite
migrations. This profile is intended to give such a test build its own state;
it is not a migration rollback mechanism or permission to install over normal
Intent data.

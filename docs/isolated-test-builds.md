# Isolated macOS test builds

The manual workflow's optional `isolated_test=true` input builds **Intent GitLab
Test**, a separate signed ARM64 application. It requires `build_macos=true`,
`sign=true`, an exact 40-character `intentd_ref`, and no other platform selection.
It does not change the normal app or its pinned sidecar.

The workflow compiles its run/attempt identity and resolved backend commit into
the application. Launch-time environment variables cannot enable or disable the
profile. Both processes use a private directory under
`~/.intent-tests/manual-<run-id>-<attempt>/`: desktop/session state, daemon database,
socket, lock, PID, configuration, workspaces, secrets and temporary files.
Legacy imports, shared Keychain synchronization, the `intent://` protocol,
system CLI installation/repair, app and daemon updates, remote pairing and
external backend transports are disabled. The test app connects only to its
bundled daemon through its private Unix socket. GitHub token lookup uses only
the private secret store.

An occupied socket, unsafe linked/shared directory, changed configuration or
different backend identity fails closed. Close the previous instance before
relaunching. Do not repoint a normal installation at this directory or reuse
its database with another daemon version. Each workflow attempt gets a new
profile. User-selected repositories and provider actions still have their
ordinary effects; use disposable test repositories and accounts.

Delivery requires the `verify-isolated-macos` job to pass on a fresh
[GitHub-hosted macOS VM](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It checks the actual signed/notarized package, architecture and backend identity;
private startup, recovery and relaunch; disabled shared actions; preserved normal
database/profile/secret/CLI sentinels; no connection to the normal socket; and
owned shutdown. Its `isolated-macos-proof` artifact and the DMG have seven-day
retention. A source check, renamed bundle, successful build, or Linux unit test
alone does not establish packaged isolation.

The ordinary manual installer remains unsuitable for unshipped SQLite
migrations. This profile is intended to give such a test build its own state;
it is not a migration rollback mechanism or permission to install over normal
Intent data.

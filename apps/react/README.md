# React application preview

This is an internal, unreleased application preview. `/workspaces` connects to an
existing local Intent daemon; `/sandbox` is the component catalog.

## Fresh checkout on macOS or Linux

Use the Node version in the root `package.json` `engines.node` range and the pinned
`packageManager` pnpm version. Install the committed dependency graph:

```sh
pnpm install --frozen-lockfile
```

Start intentd separately, with a configured provider and an existing workspace and
agent. From the repository root, the single frontend startup command is:

```sh
INTENT_DEV_DAEMON_BRIDGE=1 pnpm --filter @intent/react dev
```

Open the printed loopback URL at `/workspaces`, select a workspace, open **Agents**,
and choose an existing agent. The composer sends text and selected image/file
attachments; **Stop** interrupts an active response. Acknowledged drafts and
messages survive reload. A local edit, including clearing the text, is retained
through a temporary disconnect and saved after reconnection.
Drafts queued under a retired account or backend are canceled. Reconnection resubscribes
without automatically resending an uncertain submission. An explicit retry may warn
that delivery is uncertain before offering a resend.

The bridge uses `~/Library/Application Support/intentd/intentd.sock` on macOS and
`${XDG_DATA_HOME:-$HOME/.local/share}/intentd/intentd.sock` on Linux. For an isolated
installation, prefix the same command with `INTENTD_SOCKET=/absolute/owned/intentd.sock`.
`DEV_PORT` selects the frontend port. The dev-only bridge grants the browser full
access to that daemon; use an owned test daemon/workspace for mutation acceptance.
No Electron preload, protected local Themis patch, or live user workspace is required.

Use the paperclip to select local images or files. Wait for upload completion before
sending; registered attachments survive draft reload. Remove a chip to exclude it.
An interrupted upload can be retried while its local file is still available. After
a reload, an unfinished browser upload must be removed and reselected. Existing
unsupported draft items remain visible and block sending until removed. The native
connected checkpoint covers PNG and small text files through the chooser; other
formats, clipboard attachments, and external file drop are not established here.
Clearing browser storage removes this browser's client identity and its access to
client-scoped drafts; it does not delete the daemon's chat history. If browser
storage is unavailable, client identity lasts for the tab session.

## Focused verification

```sh
pnpm --filter @intent/react typecheck
pnpm --filter @intent/react build
pnpm run test:unit apps/react/src/features/workspace/workspace-conversation-composer.test.tsx
```

The maintained native test `packages/view-parity/tests/workspace-chat-send.extended.spec.mjs`
is mutating and fails closed without explicit owned-daemon fixture and socket-peer
proof inputs. Its launcher must verify the daemon process/socket identity before
starting the bridge; never point it at a user's live workspace. It exercises actual
provider output and Stop, acknowledged draft reload, transport reconnect, persisted
message identity, navigation cleanup, and desktop/narrow captures. The companion
`workspace-chat-attachments.extended.spec.mjs` uses authored safe PNG and text files,
corroborates registered bytes and persisted blocks, and exercises draft reload,
removal/reselection, cancellation of a pending upload and actual provider output.
Both tests require the same owned-daemon guards. Unit policy tests are separate
from provider acceptance.

This checkpoint does not establish full Svelte migration or visual parity. Existing
root dead-code findings and separately recorded codec, avatar, native IME, genuine
MESSAGE-link data, and publication limitations remain open.

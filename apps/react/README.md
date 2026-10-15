# React application preview

This is an internal, unreleased application preview. `/workspaces` connects to an
existing local Intent daemon; `/sandbox` is the component catalog.

## Fresh checkout on macOS or Linux

Use the Node version in the root `package.json` `engines.node` range and the pinned
`packageManager` pnpm version. Install the committed dependency graph:

```sh
pnpm install --frozen-lockfile
```

Start intentd separately with a configured provider. Have an existing local Git
repository available on that daemon host, or use a workspace already listed there.
From the repository root, the single frontend startup command is:

```sh
INTENT_DEV_DAEMON_BRIDGE=1 pnpm --filter @intent/react dev
```

Open the printed loopback URL at `/workspaces`. Choose **New workspace**, select or
enter an existing local repository folder, and enter its base branch or ref. The
preview creates an isolated checkout without running the repository’s setup script.
It waits for the saved creation request before submitting; repeated activation does
not issue another request. If the outcome is uncertain, **Recover creation** reuses
the same request key. Closing the form cannot undo a workspace already created by
the daemon. Local repository creation currently requires host-owner access; GitHub
cloning, new-repository initialization and the full desktop initializer are outside
this preview.

After creation, or after selecting a listed workspace, open **Agents**.
Choose an existing agent or **Create new agent**, including when the list is empty.
Creation uses the workspace's configured default provider and model, waits for its
catalog, and opens only the agent ID returned by the daemon. The control stays
pending during creation; a definite failure allows another attempt. If creation
cannot be confirmed, check the agents list: the preview blocks another create from
that control rather than automatically risking a duplicate. Leaving the workspace
does not delete an agent that the daemon may already have created.

The composer sends text and selected image/file
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

Choose the model beside the paperclip to change this conversation's model and
reasoning effort. A conversation that has already started asks for confirmation
before a model or provider switch. A choice made during a response waits until
that response finishes; Send waits for active model/effort writes to settle.
These controls do not change the workspace or global default. The picker’s
settings action opens a read-only view of configured providers; configuration
and sign-in remain in the desktop app. The native connected checkpoint covers
one configured Codex provider, not cross-provider switching or onboarding.

Pending permission requests appear in their agent conversation. Inspect the
request details, then choose one of the provider's available one-time options.
Submitting disables the choices; a failed response keeps the request visible for
an explicit retry. Reconnection and reload recover requests still pending at the
daemon. Number and Escape shortcuts apply only while focus is inside that request,
not while editing the composer.

The native permission checkpoint covers Codex's non-writing **Implement this plan?**
review with an isolated daemon configured for interactive permissions and a
read-only sandbox. Approving resumes the approved chat-only plan; keeping plan
mode completes the proposal without implementing it. This does not establish
ordinary command/file approval: the pinned daemon denies restricted Codex sandbox
escalation. Do not loosen that policy to reproduce this preview.

Open **Changed files** in a workspace to review a file's staged (HEAD to index)
or unstaged (index to worktree) changes. The same path can have a separate row in
each group. The diff view shows line numbers and additions/deletions, with
**Refresh** and **Back** to the originating row and filter. Deleted files do not
require current file contents. This checkpoint covers the primary Git root only;
workspace owners can **Stage** or **Unstage** one file from its row or diff view.
These actions update the index and preserve the working file. Pending writes stay
owned while navigating; locked files and unavailable write admission disable the
actions. After a category disappears, **Back** focuses the same file in its
remaining category. There are no hunk, discard or push controls. The pinned daemon does not
distinguish binary files from omitted oversized diffs, so path-only responses are
shown as text diff unavailable, rather than as no changes. Rename hunks follow the
daemon's destination-path representation; full editor and rename-history parity
are not claimed.

To make a local commit, review the staged rows, enter a **Commit Message**, and choose
**Commit**. The repository must have a Git author configured. This commits the primary
repository's current index at execution time and leaves unstaged worktree changes
untouched. It does not freeze the reviewed bytes: another Git process can change the
index between review and execution. Fresh staged-path, authority and lock checks
protect the app's request, not that external race.

A successful response shows its exact commit SHA, message and files. **Inspect latest
commit** is read-only history inspection, not proof that an uncertain request succeeded.
Pending commits stay owned through navigation. An unknown outcome blocks another
commit in the current app session and is never automatically retried. Reload does not
replay a commit, but it clears the in-memory uncertainty warning: inspect Git history
and staged changes before attempting another commit. The commit-message draft follows
the existing workspace lifetime and is cleared when leaving that workspace; it is not
a durable chat draft. No push, amend or remote review operation is included.

The **Commits** section lists primary-root history in daemon-provided order. Expand
a short SHA to inspect its exact metadata and changed paths, then open a path for
that commit's read-only diff. **Back** returns to the expanded row and file. Load
more current commits or earlier history across the workspace-start boundary when
available; **Refresh** restarts paging. Root commits use the daemon's empty-parent
diff, and deleted paths never fall back to current file contents. The pinned history
protocol follows first-parent history and omits merge commits. Binary or omitted
oversized bodies remain unavailable text diffs. This is a bounded history view,
not the full desktop timeline or multi-root history. Browsing it does not resolve
an unknown commit outcome or enable resending that request.

Open an existing primary-root text file to edit it, then choose **Save** or press
**Ctrl/Cmd+S** while its editor has focus. Editing supports complete UTF-8 text up
to 500 KiB with consistent LF or CRLF endings; BOM and existing line endings are
preserved. Partial previews, larger files, binary content, attachments and mixed
line endings remain read-only. This is a bounded Monaco host, not full desktop
FileTab or rich Markdown editing.

Edits stay in the canonical file draft until explicitly saved. An earlier save
acknowledgement preserves newer edits. Leaving the file discards unsaved edits;
there is no autosave. Save replaces the current file: external edits are not merged
and the daemon provides no compare-and-swap guarantee. A definite refusal keeps
the editor and draft available for deliberate retry. An unknown result blocks
another save for that resource in the current session. Reload never replays the
write, but clears this in-memory warning; inspect the actual file before deciding
whether to edit and save again. Use **Changed files** to review the resulting diff.

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
These tests require the same owned-daemon guards. The companion
`workspace-agent-create.extended.spec.mjs` starts from an empty isolated workspace,
corroborates exactly one created agent and its configured provider/model, sends the
first message, checks genuine streaming and persisted IDs, then verifies reload,
list navigation and subscription cleanup at desktop and narrow widths. Unit policy
tests are separate from provider acceptance. `workspace-local-create.extended.spec.mjs`
starts at Home with an authored disposable local repository, checks the actual
isolated checkout and base commit, then exercises new-agent/first-message creation,
reload, listing and cleanup. Its second case covers retained input and an invalid
base followed by a definite retry. It has the same owned-daemon mutation guard.

`workspace-permission-decision.extended.spec.mjs` additionally requires an exact
hash of a genuine, inspected, already-pending non-writing plan request and explicit
owned-daemon decision scope. It checks keyboard/pointer choice, reload/reconnect
recovery, exact daemon acknowledgement, persisted plan content and reader cleanup.
It does not fabricate requests or run requested commands.

`workspace-git-review.extended.spec.mjs` uses an owned disposable repository with
both stages of the same file, added/deleted/renamed paths and binary/large-file
responses. It verifies genuine Git payloads, refresh, reload, Back focus/position,
containment and read/worker cleanup at desktop and narrow widths. It performs no
Git writes; fixture preparation is a separate owned-repository step.

`workspace-commit-history.extended.spec.mjs` checks real current/older paging,
exact-SHA metadata and committed-file diffs, root/deleted/renamed/binary cases,
both Back paths, reload and read cleanup at desktop and narrow widths. It requires
an explicitly identified owned daemon and pre-recorded genuine repository evidence;
the test itself performs no Git writes.

`workspace-file-edit.extended.spec.mjs` requires a fresh owned daemon and disposable
primary-root repositories. It checks native typing, explicit Save and the scoped
shortcut, exact BOM/CRLF bytes, unchanged index and unrelated files, reopen and Git
diff, read-only neighbors, model disposal, and desktop/narrow captures. A separate
case makes only the owned fixture read-only to prove a genuine daemon refusal and
explicit retry. Authority retirement, queued content-kind changes, unknown results
and a later edit during an earlier save are policy tests, not injected native proof.

This checkpoint does not establish full Svelte migration or visual parity. Existing
root dead-code findings and separately recorded codec, avatar, native IME, genuine
MESSAGE-link data, and publication limitations remain open.

`workspace-git-staging.extended.spec.mjs` requires an explicitly owned disposable
Git fixture and `ISOLATED_GIT_WRITES=owned-test-daemon`. It uses native keyboard and
pointer activation, actual daemon stage/unstage, mixed index/worktree diffs,
reload, bounded return anchoring, and canonical read/write cleanup. Never run
this mutation acceptance against a user workspace.

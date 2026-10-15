# React application preview

This is an internal, unreleased application preview. `/workspaces` connects to an
existing local Intent daemon; `/sandbox` is the component catalog.

## Fresh checkout on macOS or Linux

Use the Node version in the root `package.json` `engines.node` range and the pinned
`packageManager` pnpm version. Install the committed dependency graph:

```sh
pnpm install --frozen-lockfile
```

Start intentd separately. Local workspace creation, file browsing/editing and local
Git commits do not require provider sign-in. A configured provider is needed for
agent conversations. Have an existing local Git repository on the daemon host with
at least one commit, a valid base branch/ref, and a Git author configured. You can
also use a workspace already listed there. From this frontend repository's root:

```sh
INTENT_DEV_DAEMON_BRIDGE=1 pnpm --filter @intent/react dev
```

Open the printed loopback URL at `/workspaces`.

The bridge uses `~/Library/Application Support/intentd/intentd.sock` on macOS and
`${XDG_DATA_HOME:-$HOME/.local/share}/intentd/intentd.sock` on Linux. For an isolated
installation, prefix the same command with `INTENTD_SOCKET=/absolute/owned/intentd.sock`.
`DEV_PORT` selects the frontend port. The dev-only bridge grants the browser full
access to that daemon; use an owned test daemon/workspace for mutation acceptance.
No Electron preload, protected local Themis patch, or live user workspace is required.

## First local editing workflow

1. On Home, choose **New workspace**, enter the local repository folder and its
   base branch/ref, then choose **Create workspace**. This creates an isolated
   checkout without running the repository's setup script.
2. Expand **Files** directories or use its search control to find a filename/path,
   then open an existing small text file. Type an edit.
   Try **Back**, then **Stay** to keep the unsaved text and editor position.
3. Choose **Save**, then **Back**. The original repository remains unchanged;
   the edit is saved in the new workspace checkout.
4. **Changed files** updates after the confirmed Save. Open the file's unstaged
   row and inspect the diff. Choose
   **Stage**, then **Back** to review its staged row.
5. Enter a **Commit Message** and choose **Commit**. The confirmation shows the
   actual local commit SHA. This commits the current index, so check for unrelated
   staged files first; it does not push anything.
6. In **Commits**, choose **Refresh**, expand that SHA, and open its file to inspect
   the committed diff. **Back** restores the originating history row.
7. Reload and reopen the file through **Files** to see the saved content. Reload
   does not replay Save or Commit. Unsaved drafts are not persisted across reload.

This local sequence is verified on an owned Linux daemon without credentials at
desktop and narrow widths. The agent-assisted variant below requires a configured
provider. The following sections describe the supported boundaries and recovery behavior.

## First agent-assisted edit

1. Open an owned workspace and an idle conversation under **Agents**.
2. Choose **Add repository file**, search for an existing small text file, and
   select its exact path. Type a precise request to change only that file, then
   choose **Send**. Context references point to live files; they do not freeze bytes.
3. Wait for the provider to finish. Choose **Back to Workspace**, then
   **Refresh git status** in **Changed files** to load the external edit.
4. Open the unstaged diff and review the actual changes. Choose **Stage**, then
   **Back**. Check all staged paths before continuing.
5. Type a **Commit Message**, check its text, and choose **Commit**. Inspect the
   confirmed SHA. This commits the current index locally; it does not push.
6. Refresh **Commits**, open the new commit's file, then return and reload.
   Reopen it through **Files** to inspect the saved result. Reload does not resend
   the prompt or repeat the commit.

The maintained Linux acceptance uses a configured Codex provider for one exact
file edit, with real tool completion, disk/diff/index/tree checks and desktop/narrow
browser input. Other providers and edits requiring restricted permissions are not
established by this checkpoint. Use an owned test workspace; review every change
before committing. The preview remains internal and unreleased.

## Workspace creation and conversations

Select the workspace heading to rename its displayed title. Enter or clicking away
saves a nonblank changed name; Escape cancels. The accepted title is shared by the
heading, sidebar and Home search, and persists after reload. This changes no Git
branch, repository folder or file. A failed request allows another explicit edit.
An unknown outcome blocks renaming for the current session: check the current title
before making further changes. Reload clears the in-memory warning without replaying
the request. Client freshness checks do not provide an atomic comparison with other
clients' simultaneous title changes.

Local creation waits for the saved creation request before submitting; repeated activation does
not issue another request. If the outcome is uncertain, **Recover creation** reuses
the same request key. Closing the form cannot undo a workspace already created by
the daemon. Local repository creation currently requires host-owner access; GitHub
cloning, new-repository initialization and the full desktop initializer are outside
this preview.

For chat, configure and sign in to a provider through the desktop app first.
After creation, or after selecting a listed workspace, open **Agents**.
Choose an existing agent or **Create new agent**, including when the list is empty.
Creation uses the workspace's configured default provider and model, waits for its
catalog, and opens only the agent ID returned by the daemon. The control stays
pending during creation; a definite failure allows another attempt. If creation
cannot be confirmed, check the agents list: the preview blocks another create from
that control rather than automatically risking a duplicate. Leaving the workspace
does not delete an agent that the daemon may already have created.

Select the conversation heading to rename an existing agent. Enter or clicking
away saves a nonblank changed name; Escape cancels. The accepted name appears in
**Agents**, its name search, and the conversation after reload. This does not send
a provider prompt. Failed requests allow a deliberate retry; an unknown outcome
blocks another rename for the current session, including reconnect. Check the
current name before making further changes; full reload clears the in-memory
receipt without replaying it. Freshness checks protect local drafts and late replies,
but do not provide atomic comparison with another client’s simultaneous rename.

The composer sends text and selected image/file
attachments; **Stop** interrupts an active response. Acknowledged drafts and
messages survive reload. A local edit, including clearing the text, is retained
through a temporary disconnect and saved after reconnection.
Drafts queued under a retired account or backend are canceled. Reconnection resubscribes
without automatically resending an uncertain submission. An explicit retry may warn
that delivery is uncertain before offering a resend.

While a response is active, type a plain-text follow-up and choose **Queue message**
(or press Enter). **Queued messages** shows the daemon's current entries and order. Consecutive plain-text
follow-ups from the same author can merge into one entry; **Remove** removes that
whole displayed entry. A confirmed receipt means it is no longer queued, but it may
already have been delivered. Failed removals keep the row available for deliberate
retry. An unknown removal stays blocked in this app session; **Refresh** only reads
the queue. Reload/reconnect reads the actual queue and never replays input or removal.
The queue control does not accept attachments, note context or repository file context, and does not edit,
reorder, send immediately, or clear the entire queue. Stop remains available while
typing a follow-up. Removal receipts are not persisted across page reload or process restart.

Use **Add note context** to select an existing ordinary Markdown note from this
workspace. The picker shows note IDs to distinguish duplicate titles. Remove a
note chip to exclude it. Acknowledged drafts restore references after reload;
note bodies are read by the agent when it uses the selected context, not copied
into the draft. Type a prompt and explicitly Send while the agent is idle.
Unavailable notes remain visible and block sending until refreshed or removed.
The daemon's busy-turn queue does not preserve every note hint, so this preview
requires waiting for the current response; another client's simultaneous Send
can still race that check. This is an internal same-workspace note picker, not the
full desktop context or mention editor.

Use **Add repository file** to search the primary workspace repository by filename
or path. Select the exact path, then type a prompt and **Send** while idle. Remove
its chip to exclude it. Acknowledged drafts retain only the workspace, root and
path across reload/reconnect. This bounded preview checks complete ordinary text
up to 16 KiB through the canonical file reader before sending. Missing, incomplete,
non-text or retired-root references remain in the draft and report an error;
remove or deliberately retry them. The agent reads the live file: selection does
not freeze bytes, and another client can change the file or start a turn after
validation. Repository references follow the same idle-only limitation as notes.
Folders, secondary roots, external paths and content search are not supported.

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
A confirmed editor Save automatically refreshes Changed files and matching open
worktree diffs. **Refresh git status** remains available for external changes or
a failed status read. Failed or unknown Save outcomes do not imply a successful
Git refresh; their existing recovery rules still apply.
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

The workspace **Files** section browses the primary repository root. Expand a
directory to load its immediate children, then open a file in the editor or
read-only preview. Arrow keys, Home and End move through visible rows. **Back**
returns to the opened row with its expansion, focus and viewport position retained.
**Refresh** reloads the root and currently visible expanded directories; failed
directory reads show an error and **Retry**, separately from empty directories.
Reload starts a fresh tree. This browser has no file-management actions, recursive
expand-all, drag and drop or secondary-root browsing. Out-of-workspace symlink
targets remain subject to the daemon's containment checks.

Use the search control inside **Files** to find unchanged as well as changed files
by workspace-relative name/path. Plain text matches case-insensitively; glob patterns
are supported by the daemon. Searches respect its ignore rules and return at most
100 matches; a notice appears when more exist. Refine the query rather than paging.
Use Up/Down and Enter, or click a result, to open it. Back retains the query and
restores the result's focus and position; clearing the query restores the expanded
tree. Search is independent of the **Changed files** filter. Invalid patterns and
read failures show an error with Retry; an empty query sends no search. Workspace
or connection changes and full reload retire the search; queries are not persisted.
This is a file-name finder, not content search or a cross-repository index. The
pinned daemon normalizes path separators; literal POSIX backslash filenames are
not a supported round-trip through this search.

Open an existing primary-root text file to edit it, then choose **Save** or press
**Ctrl/Cmd+S** while its editor has focus. Editing supports complete UTF-8 text up
to 500 KiB with consistent LF or CRLF endings; BOM and existing line endings are
preserved. Partial previews, larger files, binary content, attachments and mixed
line endings remain read-only. This is a bounded Monaco host, not full desktop
FileTab or rich Markdown editing.

Edits stay in the canonical file draft until explicitly saved. An earlier save
acknowledgement preserves newer edits. In-app navigation with unsaved edits asks
for **Stay** or **Discard unsaved edits**. Stay keeps the draft and editor selection;
discard leaves without saving. A pending or unknown save remains tracked after
departure: leaving does not cancel a write already sent. Clean files leave normally.
The browser can show its standard unload warning for a dirty editor on reload or
tab close; accepting unload loses the in-memory draft. There is no autosave or
persistent draft recovery. Save replaces the current file: external edits are not merged
and the daemon provides no compare-and-swap guarantee. A definite refusal keeps
the editor and draft available for deliberate retry. An unknown result blocks
another save for that resource in the current session. Reload never replays the
write, but clears this in-memory warning; inspect the actual file before deciding
whether to edit and save again. Use **Changed files** to review the resulting diff.

## Workspace notes

Choose **New note** in **Notes**, enter a nonempty title, then choose **Create note**.
The confirmed note opens in the Markdown editor, including when the list was empty.
The title form stays open on a definite failure so you can deliberately retry. Closing
a pending form does not cancel an already-sent creation or open its eventual result.
An unknown creation outcome blocks another creation in this app session: inspect the
notes list, but do not infer success from a matching title. Reconnect never resends;
full reload clears this in-memory warning without replaying the request.

Open an existing ordinary note from **Notes**, then choose **Edit Markdown**. Complete Markdown
notes up to 500 KiB support source editing with **Save** or **Ctrl/Cmd+S**. **View saved
note** returns to the accepted rendered content after saving. Spec/default notes, task
notes, incomplete bodies and task-conversion directives stay read-only in this preview.
This does not include note renaming, deletion, comments or the rich desktop editor.

The canonical note writer sends the loaded revision as the daemon's merge base.
Concurrent changes can be merged; the accepted response and revision become the next
base while edits made during a save remain unsaved. This is not an atomic compare-and-swap
guarantee: the daemon can fall back to replacement if historical merge content is
unavailable, and can refuse a large content reduction. Review the accepted Markdown.

Dirty navigation offers **Stay** or **Discard unsaved edits**. Discard never undoes a
write already sent. Temporary reconnects retain the draft and do not resend Save;
full reload loses unsaved drafts. A definite failure preserves the draft for explicit
retry. An unknown result blocks further saves for that note in this app session.
Inspect the saved note before deciding how to proceed; refetch alone does not prove
which request succeeded. Reload clears the in-memory warning without replaying writes.

## Focused verification

`workspace-note-create.extended.spec.mjs` exercises title entry, exact returned creation
identity alongside a concurrent sibling, explicit Save, filtering and reload/reconnect.

`workspace-note-edit.extended.spec.mjs` exercises existing-note Markdown editing,
explicit Save with a genuine concurrent merge, dirty navigation, reload/reconnect and
unchanged unrelated notes/repository state on an owned no-provider daemon at both widths.

```sh
pnpm --filter @intent/react typecheck
pnpm --filter @intent/react build
pnpm run test:unit apps/react/src/features/workspace/workspace-conversation-composer.test.tsx
```

`workspace-local-workflow.extended.spec.mjs` is the integrated local acceptance
journey: Home creation, nested-file edit, dirty-navigation Stay, Save, exact diff,
Stage, explicit current-index Commit, exact SHA/tree and history-file inspection,
reload and cleanup at desktop/narrow widths. It uses native UI input and a guarded
owned no-credential daemon, corroborates the actual checkout, disk and Git index,
and checks that the source repository and unrelated files remain unchanged. It
does not create an agent, send a prompt or claim current-head chat verification.

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

`workspace-file-browser.extended.spec.mjs` uses an owned disposable hierarchy and
checks actual lazy reads, duplicate basenames and unusual names, editor opening,
Back restoration, dirty-editor Stay/Discard, empty directories, a genuine read
failure and retry, refresh, reload, workspace switch and cleanup at desktop and
narrow widths. Browser controls issue no file writes; disk bytes and the Git index
are checked independently. Fixture preparation and permission changes are confined
to the owned test repository. Overlapping initial refresh and retired replies are
covered separately by shared-owner policy tests.

This checkpoint does not establish full Svelte migration or visual parity. Existing
root dead-code findings and separately recorded codec, avatar, native IME, older
in-body MESSAGE targets, full platform coverage, and publication limitations remain open.

`workspace-git-staging.extended.spec.mjs` requires an explicitly owned disposable
Git fixture and `ISOLATED_GIT_WRITES=owned-test-daemon`. It uses native keyboard and
pointer activation, actual daemon stage/unstage, mixed index/worktree diffs,
reload, bounded return anchoring, and canonical read/write cleanup. Never run
this mutation acceptance against a user workspace.

## Workspace terminal

In a workspace, choose **New Terminal**, or **Open** beside a listed terminal.
The shell starts in the primary workspace folder and does not need a configured
provider. Type commands directly; the terminal follows the view's size. **Hide
terminal**, navigation and reload detach the view without closing the daemon PTY.
After returning or reconnecting the app connection, open the listed terminal again
to restore its available buffer. **Reconnect**
reattaches to that same ID; a missing terminal is reported and is never recreated
automatically. Use **Close Terminal** and confirm to stop its process.

Creation and closing remain pending until their actual responses arrive. If a
response is lost, the preview reports an unknown outcome and blocks resending that
operation in the current application session. Refresh and inspect the daemon's
terminal list; a list entry alone does not correlate a lost creation request.
These operation receipts are not persisted across a full reload, and reload never
replays creation, closing or input. Buffer restoration has no exactly-once output
claim across a disconnect. This is a bounded interactive host, without the desktop
quake overlay, script manager or terminal history UI.

## Quick switcher (internal preview)

Choose **Quick switcher** above the workspace content, or press **Cmd/Ctrl-K**.
Search by name or ID, use the arrow keys and Enter, or select a result. Escape
closes the dialog and restores focus. Home offers workspaces; inside a workspace,
the switcher also offers its confirmed foreground conversations. It does not search
conversations across workspaces. IDs distinguish conversations with the same name.
Loading and retry states come from the existing scoped readers. Editor and terminal
shortcuts retain their own handling. Navigation uses the existing unsaved-edit
Stay/Discard dialog; switching does not save or change files, notes, or conversations.

This remains an internal, unreleased React workflow. The released assistant app
guide is not promoted or published by this checkpoint.

## Links inside conversations (internal preview)

Use **Copy text** to copy the available complete text/Markdown of a saved ordinary
user or assistant message, preserving its code/link syntax and line breaks. Tool
output, thinking, stored context payloads, and binary attachments are excluded.
Copy text requires a saved, non-provisional row. Streaming, interrupted, empty, or
unsupported text shows an unavailable notice; copying does not fetch additional
content. Success appears only after clipboard acknowledgement;
use the same button to retry a denied or unavailable clipboard.

Use **Copy message link** on a saved ordinary user or assistant message. The control
confirms when the clipboard accepts the link; if copying fails, use it again to retry.
Unsaved and provisional rows do not offer links. A link identifies the owning
conversation and message, not the displayed sender.

Open a message link inside a persisted conversation to focus its exact target.
Browser Back returns to the message containing the link and restores its reading
position. Bare URLs in user messages are clickable; explicit Markdown links and
code keep their existing meaning. Invalid message links do not navigate. A link
that cannot be opened shows an unavailable-message notice and retains the transcript.

The owned-fixture checkpoint covers resident targets in the same or another
conversation, desktop/narrow navigation, Back, reload, reopening from the Agents
list, and an unavailable target. Fixture messages were
created through real Send/provider acknowledgements before navigation measurement.
It does not extend the historical read-only direct-URL evidence to older in-body
targets, cross-backend access or full desktop/platform parity. This remains internal
and unreleased; the released assistant app guide is not promoted by this checkpoint.

# Changelog

## 0.2.11

- Optimize home page and workspace loading for faster startup.
- Choose your preferred monospace font for editors and diff viewers.
- All interactive agents now organize long responses into collapsible groups, not just the Coordinator. Think/reasoning blocks from external providers are parsed and displayed correctly.
- Workspace creation is more reliable. Duplicate agent activations are prevented and setup scripts auto-restore per repo.
- Fixes: Intel Mac support, workspace deletion errors, changes panel getting stuck on loading, spec panel not opening on existing workspaces, GitHub links now open in your browser, npm cache collisions between concurrent agents, and lifecycle events (rename, archive) now update across all windows.

## 0.2.10

- Agent responses can now be organized into collapsible groups, making long outputs easier to scan.
- New workspaces start with a single panel. The spec slides in once the agent begins writing it.
- Redesigned workspace sidebar with phase indicators and PR status pills.
- Faster workspace loading. New workspaces skip unnecessary git operations and show the streaming indicator right away.
- MCP server startup errors now surface in the UI instead of failing silently.
- Cmd+F search works in chat and notes panels. Open workspaces listed in the Window menu.
- Fixes: memory leaks on workspace close, MCP server restart loops, stale changes panel after file event drops, streaming content lost on workspace switch, fork session corruption, and queued messages now process in the background.

## 0.2.9

- Settings page reorganized for clarity.
- Agents are named by role (Coordinator, Implementor, Verifier) instead of random names.
- Per-group commit buttons in the changes panel let you commit each agent's work independently.
- Auto-commit is now respected everywhere. When you turn it off, agents will not commit on your behalf.
- Delegated agents reliably inherit their parent's provider, fixing cases where child agents could end up on the wrong model.
- Fixes: workspace title not updating for new spaces, improved agent isolation, stale messages after agent wake-ups, streaming state lost on page refresh, subscription UI reappearing after delegation, and various small UI cleanups.

## 0.2.8

- File tracking now uses Git blob storage. Diffs and file contents are stored as SHA blobs rather than inline, with lazy resolution and cached repo checks.
- Open spaces in a new window with Cmd+Click. Also added a Markdown file editor for notes and docs.
- More reliable rebase detection. We now track the HEAD SHA and use follow-up polling, so the UI refreshes correctly after both app-initiated and external rebases.
- Fixed model selection in OpenCode. Now uses session/set_model to prevent a silent fallback to OpenRouter.
- No more duplicate task agents. If the target agent is already streaming, we skip spinning up another one.
- Two small bug fixes: Atomic file writes no longer hit a race condition (solved with unique temp paths), and remote workspace git status no longer truncates filenames.

## 0.2.7

- PR Shepherd specialist for automated PR review cycles. New `wait_for_pr_changes` MCP tool and post-merge workspace reset workflow.
- Specialists in @ mentions with activity indicators. Agent-list and confirmation UI blocks in tool call display.
- xhigh reasoning effort level and expanded model list for Codex.
- Font style settings for Notes and Agent Chat.
- Auto-retry failed messages for background agents after session recovery. Smart workspace navigation on archive/delete.
- Content-based binary detection in the diff pipeline. Multi-window support via workspace-scoped IPC broadcasting.
- Fixes: auto-rebase baseSHA/stash handling, queued messages reappearing after send, "Waiting for 0 agents" ghost message, agent display delay in workspace switcher, MCP server resilience to transient bridge failures, git polling log spam, agent permanent delete from context menu, stale session writes on beforeunload, rapid token consumption guard, deferred queued messages for inactive workspaces, improved "agent process died" diagnostics, gitignore race conditions, workspace rename race, model-drop safety warning on provider switch, tool call text overlap, Windows PowerShell setup scripts.

## 0.2.6

- Material file type icons in the file tree. Dotfiles now visible, gitignore negation patterns fixed.
- Rich browser tool call display with inline screenshots. Copy button on code blocks in Spec/Note view.
- Enhance prompt button on workspace initializer. Agents available in @ mention menu.
- Window sessions restore on app reopen. Repos persist in registry across workspace deletion.
- Auto-rebase on conflict-free merge. PR mergeability and conflict detection tools. Bulk archive/delete for workspaces.
- Links open in embedded browser panel by default.
- Windows compat improvements across process spawning, path handling, and build scripts.
- Fixes: ACP process accumulation, orphaned MCP/agent processes on quit, MCP zombie restarts, process tree cleanup for terminals and git timeouts, spellcheck in notes, setup script garbled commands, auggie detection for nvm/fnm/volta, drag-and-drop file mentions, folder expansion after cache expiry, stale git status, workspace sort jumping, Claude Code provider bugs, Check for Updates hanging.

## 0.2.5

- Reasoning effort levels for Codex.
- GitHub PR comment tools in workspace MCP. Keyboard shortcuts for suggested prompts.
- Delegated agents nested under delegator in the agents list.
- Redesigned setup script editor (two-column modal). Setup script banner in terminal.
- Native FSEvents on macOS for instant git status. Background git ops across workspace nav.
- Fixes: several agent event subscription bugs, specialist model reverting, PR targeting wrong repo, EMFILE from too many watchers, streaming state in agent creation, cross-project branch/path leak, binary diff crashes.
- Snowflake Cortex provider (behind feature flag)
- Linux build infrastructure (2026 is the year of the Linux desktop?)

## v0.2.4

- Developer specialist — new agent that plans, implements, and verifies in one shot
- Merge via PR — merge through a PR or locally from the commit panel
- Splash screen with logo while the app boots
- Branch prefix preference included in agent system prompts
- E2E smoke tests across all available providers

Fixes:

- OpenCode model picker no longer reverts to the first model on every open
- Delegated agents that error now emit agent:failed so the parent wakes up
- Fixed workspace open loop, blank chat panel on switch, empty panel flash on load
- Auto-commit race condition; cascading timeout when rapidly editing messages
- Image/file attachments work across message flows; image-only messages send correctly
- Branch rename validates the old ref before trying (no more fatal)
- Ctrl+W passes through to terminal on macOS
- Misc: spaces overlay UX, new-space modal polish, sidebar icons, commit panel, loading states

## v0.2.3

2 new features:

- one-click Auggie Context Engine install for Claude Code, Codex, and OpenCode
  @terminal mentions — Agent can now read from and interact with terminal sessions

bunch of fixes (40+ commits):

- Auth — New browser-based login flow with polling and manual paste fallback
- Agent stability — Fixed several causes of agents getting stuck or producing corrupted output
- Tool call rendering — Cleaner display for tool calls like delegate-task and run-command
- Auto-commit — Inline status in chat, fixed empty commit messages, better local repo support
- UI polish — Theme fixes, draggable title bar, scrolling and crash fixes in editors
- Provider fixes — Fixed race conditions and bad model IDs in external provider connections
- Crash fixes — Handled various edge cases causing crashes in terminals, tooltips, and file trees

## v0.2.2

- Pasting Markdown into Notes now preserves formattingSmarter implementor agent — upgraded from "fast" to "smart" model tier
- 413 errors: context-too-large errors now gracefully reduce history instead of crashing
- Model picker was showing wrong model for delegated agents; now validates against available models
- Sidebar can move to the right (collapse)
- Removed broken auto-restart loop, added switch-back button on provider mismatch
- Tool display file paths shown properly, "Completed" status for successful tools, better error messages
- Stability: fixed sidebar scroll overflow, spurious Vite reloads, Monaco error suppression, type errors & memory leaks

## v0.2.1

- Delegated agent responses now stream to the UI in real-time instead of appearing all at once. Also fixed agents not showing up until you manually refreshed.
- File paths in agent tool output are now clickable. CLI tool calls show collapsible details.
- Long tool output is truncated before being sent back in history, preventing 413 context-length errors.
- Errors stay visible after streaming stops instead of disappearing. Simplified StreamingStatus component.
- Terminal cmd+f find works properly now.
- Misc: toast close button fix, skipWorktree UX, home grid spacing, dead feature flag cleanup.

## v0.2.0

- ACP session recovery uses a structured XML exchange format for history replay. Agent stderr is captured again.
- Needs-permission avatar state for tool calls. Previous tool calls that were never marked done now auto-complete.
- Provider-aware specialist model resolution via modelTier. Agents always launch with the resolved provider model.
- MCP servers are passed via ACP session/new instead of writing .mcp.json to the worktree.
- Workspace dirs consolidated under ~/intent/workspaces/.
- Version history UI replaced with a minimal inline diff viewer. Specialist picker simplified to a clean dropdown.
- File-like context menus (copy path, reveal) on agent and note tabs.
- Mermaid fullscreen overlay fills the viewport and scales the SVG to fit.
- Fixes: tool calls disappearing during streaming, regenerate not showing until refresh, dedup cache not clearing on regenerate, tool-call-only messages lost on edit/regenerate, double agent notifications, edit_note on empty notes, unknown language highlighting, empty error card fallback, SIGSEGV in AsyncWrap during GC.

## v0.1.69

- Agent responses no longer duplicate, fragment, or go missing. Several streaming bugs caused text to repeat, appear in the wrong message, or get lost when messages were queued. All fixed.
- Large notes no longer freeze the app. Markdown processing happens in the background now, and the file tree and git history load significantly faster.
- @ mentions got a major upgrade. Fuzzy search understands file paths, the dropdown is wider and anchored to the input, clicking a file mention opens it, and notes show their title instead of an ID.
- File management from the sidebar. Create files inline, delete with undo, right-click tabs to copy paths or reveal in Finder. "Reveal in Sidebar" works.
- Agents auto-commit after every turn, not just when a task finishes.
- Delegated agents no longer get blocked by a provider mismatch. Child agents correctly inherit their parent's provider.
- Crash recovery is better. Errors that used to blank the screen now show a useful error card with copy-to-clipboard. Benign framework errors are suppressed.
- New toast system with color-coded types (warning for destructive actions) and 15 seconds to undo.
- Spaces switcher shows workspace status, repo name, and agent activity. You can click to select.

## v0.1.68

- Fixed agent response duplication where streaming content from previous messages would bleed into new ones. Stream IDs are now unique per message turn, and chunk/complete handlers find the correct message by its streaming flag instead of assuming it is the last one.
- Provider inference no longer falls back to the legacy 'acp' protocol name. Agent provider is now extracted from compound model IDs (e.g. `opencode:haiku4.5`) so child agents, backend sessions, and the mismatch check all resolve to the real provider.
- IPC listener cleanup uses targeted `offById()` removal instead of `removeAllListeners()`, which was wiping out agent subscription listeners on stream channels. Also fixes leaked notification subscriptions on repeated workspace:open and removes the destructive visibilitychange cleanup handler.
- Cmd+backtick / Ctrl+backtick now toggles the terminal even when an input is focused (new `global` shortcut property that bypasses the input-focus check).
- Coordinator specialist now reminds agents to keep the Spec note up to date as the source of truth.
- Entrance animations on workspace page layout sections.

## v0.1.67

- "what commits are relevant" logic (in the changes sidebar) should be a bit more robust, and you can now see previous commits and manually change which ones to see
- “intent`CLI and deep-links. You can install the`intent`command from the app menu or command palette, then run`intent <repo-path>` to open a workspace. Deep-links (`intent://`) navigate to the create-workspace form with the repo pre-filled. Handles cold start, second-instance, and dev-mode paths.
- Agents are now locked to the provider they were created with. Switching providers prompts you to start a new agent instead of silently changing models mid-conversation. This prevents bad states when people switch agent providers
- Workspace root moved from `~/.workspaces` to `~/intent` (legacy paths still work).
- fixes to agent delegation and subscriptions: idle events were being dropped, stale status was sticking around, and parent agents weren't getting notified of child deletions. Also added health checks for ACP disconnections.
- Diff viewer no longer loses your scroll position when an agent edits a file. Changes tab got commit context menus, older commit loading, and proper loading states back.
- Pasting large blocks of text into chat now collapses into an inline chip instead of flooding the input.
- Assorted smaller fixes: home page loading UX, model picker fallback, code 11 CBP detection, workspace:open race condition, empty layout defaults, tool call rendering, image-only message validation.

## v0.1.66

- BYOA: now includes opencode support (on start page & setting page). this means you can use local models with Intent
- now we render Mermaid diagrams (instead of just our own diagrams)
- migrated specialists agents to a file-based format
- activity log now has live updates, improved styling, and better attribution
- fixed a number of BOYA issue. notably:
- ModelPicker: Enhanced footer, fallback logic, and settings navigation
- Settings: Add skeleton loading states for providers and integrations
- ModelPicker refactor: Make side-effect-free by default with opt-in global updates

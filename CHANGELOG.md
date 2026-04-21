# Changelog

## 0.3.5

- Homepage workspace list now caps at 10 with a collapsible "Older" section to keep things tidy.
- Agent previews show the tool icon and label when the latest block is a tool call, so you can tell at a glance what an agent is doing.
- Image token usage is optimized to use less context when working with images.
- Enhanced deep link support for easy workspace creation.
- Fixes: ACP agents recovering from invalid tool-call history, workspace switching preserves layouts, shutdown UX and orphan-recovery race guards tightened, duplicate streaming assistant messages, agents no longer appear stuck as streaming in the overview tree, running delegated agents are visible when collapsed and sorted by recency, PR branch matching strips remote prefixes correctly, OS notifications and the bell fire again on agent idle, HttpMcpBridge restart race and orphan recovery for stuck agents, and duplicate image previews.

## 0.3.4

- Claude Opus 4.7 is now the default model for Auggie agents.
- Onboarding flow redesigned for a smoother first-run experience, with fixes for opencode-only setups.
- Agents are more resilient under memory pressure — they're no longer killed mid-response, even in background workspace tabs.
- Terminal titles are now sanitized to prevent credentials from leaking into the window title.
- Agent suggested prompts are back.
- Fixes: repeated identical messages no longer silently dropped, user messages preserved during concurrent saves, in-flight message queueing is more reliable, chat messages merge correctly with on-disk content when reopening a chat, delegated agent wake-up and subscription reliability, spec and note updates now reactively reflect task changes, dropdown crash from duplicate options, custom specialists stranded during a prior migration now recover correctly, and a streaming hang when the "done" notification arrives before stream close.

## 0.3.0

- Project-level custom specialists now load reliably, live-reload when you save changes, and show where each specialist comes from (project, user, or built-in).
- Workspace API tool calls now show rich previews in chat so you can see what workspace actions agents are performing.
- Major memory and resource improvements — idle agent processes and MCP servers are reclaimed under memory pressure, keeping things snappy on long sessions.
- Agent streaming overhaul — fixed a batch of issues that caused stuck "Thinking" states, lost messages, and infinite loops during multi-agent work.
- Fixes: agent-to-agent messages failing during interrupts, delegation events dropped on delivery failure, workspace disappearing after cleanup, panels not restoring on workspace re-open, model reverting when editing earlier messages, workspace list showing duplicate groups, notes not updating after task changes.

## 0.2.37

- Archive and delete workspaces directly from the sidebar context menu.
- Window layout is now restored after auto-updates — your open tabs and panels survive restarts.
- Model picker polish: improved layout, provider logos always visible, and the picker locks after the first message as expected.
- Idle agent processes are now cleaned up automatically, capping resource usage on long-running sessions.
- Fixes: markdown code blocks not rendering in narrow chat panels, stack overflow when sending messages with inline images, suggested reply edit button not working, memory leak from large unparseable stream messages, workspace creation modal applying the wrong initial repo, chat loading and agent wake-up reliability improvements.

## 0.2.36

- MCP tool calls now show brand logos and structured previews so you can see what tools are doing at a glance.
- New Spaces automatically inherit your globally disabled MCP servers — no need to re-disable them each time.
- Create PR, Merge, and Push buttons now appear reliably after commits and merges.
- Linear tool integration now works correctly.
- Fixes: workspace not loading on fast navigation, agent messages lost when restoring a session, messages stuck in "Thinking" state, suggested prompts not working when clicked, archived workspaces reappearing, "Waiting for" banner showing up again after dismissal, terminal connections dropping, assistant replies overwritten by stale saves, modal and animation glitches.

## 0.2.33

- Rich model metadata in the model picker — badges (Auto, Free), cost tier indicators ($, $$, $$$), and smarter sorting by priority.
- Terminal auto-recovery — frozen terminals now self-heal instead of requiring a manual page navigation.
- Prevents out-of-memory crashes when loading large agent conversations.
- Spec panel only opens when an agent is actively writing to it, instead of reopening on every workspace visit.
- Claude Opus 4.6 is now the default model for Auggie agents.
- Fixes: sent messages not appearing without a refresh, chat panel freezing during concurrent agent streaming, duplicate stream chunks from leaked IPC listeners, delayed user message display, thinking indicator not showing on follow-up messages, sidebar progress card flickering between PR and task status, agent list stuck in skeleton loading state after navigation, duplicate agent wake-up messages.

## 0.2.32

- Claude Opus 4.6 is now the default model for Auggie agents.
- Rich model metadata in the model picker — badges (Auto, Free), cost tier indicators ($, $$, $$$), and smarter sorting by priority.
- Terminal auto-recovery — frozen terminals now self-heal instead of requiring a manual page navigation.
- Prevents out-of-memory crashes when loading large agent conversations.
- Spec panel only opens when an agent is actively writing to it, instead of reopening on every workspace visit.
- Fixes: sent messages not appearing without a refresh, chat panel freezing during concurrent agent streaming, duplicate stream chunks from leaked IPC listeners, delayed user message display, thinking indicator not showing on follow-up messages, sidebar progress card flickering between PR and task status, agent list stuck in skeleton loading state after navigation, duplicate agent wake-up messages.

## 0.2.31

- Fixes: agents sidebar appearing empty after switching workspaces, crash when creating agents or changing workspace settings.

## 0.2.30

- Agent streaming is now resilient to workspace switching. Responses are no longer lost if you navigate away and come back while an agent is mid-reply.
- Corporate proxy support. Intent now trusts custom CA certificates from your OS certificate store, fixing connection errors behind corporate proxies.
- UI Designer specialist upgraded to a higher-quality model for better output and accessibility adherence.
- Faster startup and smaller install footprint.
- Fixes: false "stalled" or "no response" warnings while agents run MCP tools, provider selection resetting to the wrong provider during workspace creation, model selector reverting when clicking the Agent card, agent responses failing for conversations containing certain unicode characters, delegated sub-agents not appearing in the sidebar, agent sidebar not restoring after workspace switch, crash in Settings > Agents for workspaces created before the coding-agent override feature, background agents incorrectly waking unrelated coordinators, parent agent resuming too early when a child agent is interrupted.

## 0.2.29

- Agent provider and model locking. Once an agent session starts, the provider and model stay fixed for the duration of the conversation to keep context consistent.
- Fixes: previously pasted text appearing as the first message when creating a new agent.

## 0.2.28

- Fixes: crashes when creating agents, switching models, or interacting with panels in certain timing conditions, terminal panel getting stuck in an invisible state after closing the last terminal tab.

## 0.2.27

- Browser-mode rendering — Intent can now run in a regular browser while Electron is running, with full data access via an HTTP/WebSocket bridge.
- Notification MCP tool (`emit_notification`) lets external services push notifications into a workspace and wake specific agents.
- Workspace scripts now persist in `.intent/config.json` so they're shared across sessions.
- Cmd+/ shortcut wired up for the enhance-prompt action in workspace creation.
- Codex model list is now dynamic, matching the models your account has access to.
- Streaming status messages simplified — only the 90-second stalled threshold shows a warning, removing false-alarm "taking longer than usual" messages at 30s/60s.
- Fixes: agent chat not streaming on workspace revisit, user messages lost during workspace switch, optimistic messages disappearing on force-submit (⌘Enter), space bar not working in spec comments, terminal toggle requiring double-click, browser panels opening in wrong workspace, broken "Learn More" link in MCP settings, preferred model not resolving for general agents, PR not linking to review workspaces, terminal shortcuts blocked when tab bar was focused.

## 0.2.26

- Workspace Scripts — detect, manage, and run project scripts (dev servers, builds, tests) directly from the workspace.
- Bun-compiled binary fallback for Auggie install — no longer requires Node.js 22+ to get started.
- Terminal keyboard shortcuts: Cmd+T to create tabs, Cmd+W to close, Cmd+Shift+[/] to cycle between them.
- Scroll-to-previous arrow on user messages and sticky headers for easier navigation in long conversations.
- Interrupt priority for agent-to-agent messaging — agents can stop each other mid-response for urgent coordination.
- Prompt layer reordering for better sub-agent cache reuse.
- Note names are now clickable links in tool calls, with full content copy support.
- Last response group stays expanded when the response ends on it instead of auto-collapsing.
- Context pills render properly in sticky user message headers.
- SOURCE_BRANCH now available in setup scripts.
- Fixes: false "No response received" during tool execution, fullscreen tooltip from massive git error strings, merged PRs disappearing from workspace lists on refresh, duplicate queued events delivered to agents.

## 0.2.25

- Figma MCP integration available as a one-click install in Settings.
- Multiple provider support for all agent types. Mix-and-match providers across agents, specialists, and coordinators.
- Embedded browser now supports OAuth/authentication flows and displays website favicons.
- PR status refreshes automatically after a merge operation.
- Better timeouts and status messages for slow agent requests.
- Fixes: reset/archive buttons not showing when branch is fully merged to trunk, toggle indicators using wrong color in custom themes, ModelPicker not reflecting the correct model when editing previous messages, workspaces not grouped correctly when repositoryName is missing.

## 0.2.24

- Pinned projects in the sidebar now persist across app restarts.
- Edit button for suggested answers lets you tweak a suggestion before sending it.
- Slow-agent latency surfacing with provider-aware messaging so you know when a model is taking longer than expected.
- PR Shepherd is hidden when GitHub auth is not available.
- Fixes: GPT-5.4 `apply_patch` tool not detected for auto-commit attribution, oversized line-change indicators in the sidebar.

## 0.2.23

- Agent Skills — agents discover SKILL.md files from your project and gain repo-specific capabilities automatically.
- Go to Line with Cmd+G / Ctrl+G in the code editor.
- YAML front matter is now preserved in the markdown editor instead of being corrupted on save.
- Polished streaming animation with a cylinder scroller for response groups — smoother collapse, expand, and scroll behavior.
- "Use for all specialists" button in settings to apply your default model to every specialist at once.
- Editing a message pre-selects the model that was originally used for that response.
- Workspace list shows live task progress indicators without waiting for background enrichment.
- Fixes: agent stuck in "Thinking" state, message data loss on save, stale session events interleaving during transitions, stale disk data overwriting messages during HMR, inaccurate MCP connection status for HTTP/SSE servers.

## 0.2.22

- GPT-5.4 is now the default model for Auggie agents and available in the Codex model picker.
- Ralph agent — a new specialist that iterates in a work/test loop until the job is done.
- ACP session persistence: agent sessions survive app restarts instead of starting fresh.
- RTK command optimization setting with auto-detection and guided install flow.
- Sidebar workspaces now sort by most recently updated, with pinned workspaces first and a visual separator.
- Fixes: node-pty NAPI crash during workspace navigation, false-positive merge conflicts in automatic rebasing, rebase button not appearing after workspace switch, Windows setup terminal not expanding and newline issues in command execution.

## 0.2.20

- Fixes: Opencode no longer errors when running OpenAI models, agent response pollution across workspaces, agent streaming state not isolated by workspace, create_agent tool reactivity and background agent visibility, conversation-retrieval tool incorrectly displaying as "Search codebase", fix ReferenceError in model selection, hardened PR data flow with correct merged/draft state and invariant checks.

## 0.2.19

- PRs in the sidebar are now scoped to each workspace instead of showing every open PR across the repo.
- Cleaner onboarding — sidebar navigation is hidden during provider setup so you can focus on getting connected.
- Custom behavior prompts now carry through to delegated specialist agents.
- Improved accessibility across the app shell, navigation, and workspace UI.
- Visual polish for the diagram system.
- Fixes: blank agent created on workspace open, tool calls misrouted when provider titles replace tool names, stack overflow in deep clone operations, Node.js version check using the wrong PATH, workspace context menu bugs on Windows, broken links on settings and onboarding pages, provider selection desyncing when changed externally, workspace archive flicker on the home screen, stale agents blocking the spawn cap, PR status changes not reflected in workspace state, unhelpful error when Node.js installation is stale.

## 0.2.18

- Rebase-onto-trunk button to sync your worktree with the upstream trunk branch.
- Gitignored files now visible in the file tree with muted styling.
- Removed agent spawn cap enforcement, allowing more flexible delegation.
- Updated workspace MCP tool references.
- Fixes: default setup script not running for new users, setup script terminal not showing in overlay when loaded from backend, sidebar incorrectly showing "Synced" without PR or merge evidence, duplicate skeleton/follow-up tool_use blocks getting non-descriptive labels.

## 0.2.17

- PR mergeability tracking with visual status indicators. PR status now always visible in the overview changes tab, including closed PRs.
- Pagination for PR review comments and threads.
- Guardrails to prevent runaway agent spawn loops and token burn. Premature parent agent wake-ups in delegation chains are fixed.
- Hardened agent event subscriptions to prevent duplicate coordinator creation. MCP server setup for agents audited and tightened.
- Up arrow now edits queued messages instead of pulling from history.
- Hide empty repos on home page with a remove option. Overview agents card filters out delegated/background agents to match the agents tab.
- Node 22 requirement surfaced to users before Auggie install.
- Improved contrast and typography with semantic tokens. Bold selected theme name in color theme settings.
- Auto-approve permissions when the provider doesn't support bypassPermissions mode. Force git status refresh before auto-commit to detect agent changes.
- Fixes: diff rendering for committed agent file changes, OS notification workspace navigation, stale workspace enrichment data across surfaces, phantom polling for deleted workspaces, PR cache bypass on sidebar refresh, PR auto-discovery when pushed commit count changes, null toolName in tool-classifier, webviewReady guards on Electron webview calls, workspace-scoped state cleanup on deletion, Settings menu navigating to wrong window on macOS, toast notification for direct create-pr actions, sync calls blocking the main process.

## 0.2.12

- Provider auth status now shown in Settings. See at a glance whether you're logged in to Claude, Codex, or OpenCode, with a link to how to sign in if not.
- Redesigned changes panel with per-file grouping, "mark as viewed" checkboxes, and commit headers. Copy branch name from the changes panel or overview card.
- Files open in the editor now auto-refresh when an agent edits them, no more manual reload.
- Keyboard navigation in file search results. Cmd+O opens the workspace list as a sidebar panel instead of an overlay. Windows-specific editor and path handling.
- Queued messages no longer get stuck when event delivery races with stream completion.
- Fixes: spec panel not opening after background agent writes it, messages lost for navigated-to agents, directory clicks in file explorer, workspace switcher badge mismatches, transition crashes during workspace switching, and file:// URLs now work in the embedded browser.

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

- one-click Auggie Context Engine install for Claude Code, Codex, and OpenCode@terminal mentions — Agent can now read from and interact with terminal sessions

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

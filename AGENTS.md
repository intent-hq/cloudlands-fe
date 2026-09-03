# Agents

Quick routing guide for AI agents. Start here, then open the smallest relevant doc.

> **Merge permission**: never merge a PR or arm auto-merge without explicit permission
> from a human — approved + green is not enough. See the monorepo root
> [`AGENTS.md`](../../AGENTS.md) (resolves in a monorepo checkout) for the full rule.

## Tech stack

- Electron + SvelteKit + TypeScript desktop app
- Svelte 5 runes for UI rendering only; ALL shared/domain state MUST use Redux + sagas
- Svelte stores (`*.store.svelte.ts`) are **DEPRECATED** — do not create new ones
- Use `pnpm`; create agents via `agentFactory.createAgent()`

## Project layout

```text
src/
├── shared/          # Cross-process utilities (main + renderer)
├── lib/             # Renderer-only shared utilities & components
├── main/            # Main-process code & utilities
├── preload/         # Electron preload scripts
├── features/        # Feature-first renderer modules
│   └── <name>/
│       ├── utils/   # Feature-local utilities
│       └── main/    # Feature's main-process code
├── routes/          # SvelteKit pages
└── test/
```

## Where to look

FE docs live in the monorepo's `docs/fe/` — the `../../docs/fe/` paths below resolve
in a monorepo checkout, where this repo mounts at `packages/cloudlands-fe/`.

| Working on…         | Open                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| agents              | ../../docs/fe/agent-message-dedup-and-stream-sagas.md, ../../docs/fe/RULES_SYSTEM.md |
| state/store         | ../../docs/fe/STATE_MANAGEMENT.md, src/store/renderer/docs/                          |
| component design    | ../../docs/fe/COMPONENTS_DESIGN.md                                                   |
| panels/layout       | ../../docs/fe/panel-system-refactoring.md, ../../docs/fe/PANEL_TAB_UX_SPEC.md        |
| PR descriptions     | ../../docs/fe/PR_DESCRIPTION_GUIDE.md                                                |
| browser/CDP         | ../../docs/fe/BROWSER_PANEL_SPEC.md, ../../docs/fe/CDP_MCP_TOOLS.md                  |
| module boundaries   | ../../docs/fe/MODULE_BOUNDARY_GUIDE.md                                               |
| debugging           | ../../docs/fe/TROUBLESHOOTING_GUIDE.md, ../../docs/fe/IPC_DEBUG_GUIDE.md             |
| error handling      | ../../docs/fe/ERROR_HANDLING_SYSTEM.md                                               |
| TypeScript/types    | ../../docs/fe/TYPE_SYSTEM_GUIDE.md                                                   |
| events/IPC          | ../../docs/fe/EVENT_SYSTEM.md                                                        |
| keybindings         | ../../docs/fe/KEYBINDINGS.md                                                         |
| deploying/releasing | ../../docs/fe/DEPLOYING.md                                                           |

## Key conventions

- **Svelte stores are DEPRECATED** — All `.store.svelte.ts` files are migration targets. New shared/domain state MUST use Redux slices + sagas (ephemeral component-local UI state is fine without Redux). If refactoring encounters `.store.svelte.ts` usage, do not expand or entrench it — follow the [Migration Guide](src/store/renderer/docs/MIGRATION_GUIDE.md) to move toward complete store removal. See `../../docs/fe/STATE_MANAGEMENT.md`.
- Use `pnpm`, not `npm`.
- Put renderer product work in `src/features/`; shared utilities live in `src/lib/`.
- Create agents via `agentFactory.createAgent()`.
- Keep shared app state in `src/store/renderer/`, not ad-hoc component state.
- **Selector readables belong at component init only** — `selector()` uses Svelte context and must not run in event handlers or callbacks. Dispatch actions and perform one-time selector reads through the configured app `Store` instance, e.g. `store.dispatch(action)` and `selector.select(store.state, ...args)`. See `../../docs/fe/STATE_MANAGEMENT.md` for details.
- **Never import from a feature's **`main/`** subtree in renderer code** (or vice-versa).
- **Don't export utility functions from orchestration modules** — extract to a dedicated `utils/` file.
- **Keep utilities dependency-light** — no stores, services, or side effects.
- **Never quote the literal breaking-change footer token** — release-please treats `BREAKING CHANGE:` / `BREAKING-CHANGE:` (and `Release-As:`) appearing anywhere in a commit body as a real footer, and squash merges fold every branch commit message into the squash body, so a commit that merely _quotes_ the token causes a false major bump (or, for `Release-As:`, a forced pinned version); this accidentally cut v3.0.0 — see intent-hq/monorepo#2988. Never write the literal token in commit messages, PR titles/bodies, or review comments unless an actual breaking change is intended — when describing the mechanism, write "the breaking-change footer token" or similar instead.

## Internationalization (i18n)

All user-facing strings (labels, aria-labels, placeholders, tooltips, toasts, errors, menu items) go through Paraglide message functions — never hardcode them.

- **Messages**: call `m.*()` (import from `src/shared/paraglide/messages.js`); keys live in `messages/en.json`. Key naming: `{feature}_{component}_{purpose}`, camelCase segments, role suffixes `_label` / `_description` / `_placeholder` / `_ariaLabel` / `_tooltip` / `_error` (e.g. `settings_wsApi_port_invalid`).
- The compiled output (`src/shared/paraglide/`) is **gitignored** — run `pnpm run generate:i18n` after editing `messages/en.json`.
- **Interpolation over concatenation**: named params (`"Configure {name} path"`); sentences split by inline markup use `_before` / `_middle` / `_after` key pairs; plurals as `_one` / `_many` key pairs. Gotcha: literal `{`/`}` in a message parses as a parameter — rephrase such strings.
- **Dates/numbers**: only via `$lib/i18n/format` (renderer) or `src/shared/i18n/formatters.ts` (main/shared) — never ad-hoc `toLocaleString`, direct `date-fns` format calls, or string-built numbers/percentages.
- **Module-scope constants** holding localized text use property getters (`get description() { return m.…() }`) so strings re-evaluate on locale change; identifier-bearing fields stay literal.
- **Exemptions** — log lines, wire/IPC constants, agent-generated content, brand names, file paths, URLs, shell commands — mark with `// i18n-ignore (reason)` or `<!-- i18n-ignore (reason) -->` on the same line or the line above.
- **Enforcement**: `scripts/check-hardcoded-strings.mjs` (chained into `pnpm run lint`) blocks hardcoded strings inside `ENFORCED_DIRS`. New features in enforced dirs must be string-free from day one; when you migrate a directory to messages, add it to `ENFORCED_DIRS`.
- **Catalog completeness**: `scripts/check-i18n-completeness.mjs` (also chained into `pnpm run lint`) fails CI when any locale catalog diverges from `messages/en.json` — missing keys, extra keys, per-key `{param}` placeholder mismatches, unpaired `_one`/`_many` plurals — or when `messages/*.json` files and the `project.inlang/settings.json` locale registration disagree. It also flags non-base values byte-identical to the English value when they contain letters (letter-free values are auto-exempt): translate them, or record intentional invariants (brand names, placeholder-only strings, etc.) in `scripts/i18n-equal-allowlist.json` (per key, `"*"` or a locale array); stale allowlist entries fail the check.
- **Reference example**: `src/lib/components/settings` (the pilot extraction).

## Common commands

```bash
corepack pnpm run dev:ui        # Fast named-state UI preview
corepack pnpm run dev:web       # Complete plain-browser renderer
corepack pnpm run dev           # Standard Electron launcher
corepack pnpm run dev:cdp       # Electron launcher with CDP support
corepack pnpm run build         # Production build
corepack pnpm run check         # Svelte + TypeScript checks
corepack pnpm run lint          # ESLint
corepack pnpm run format        # Prettier write pass
corepack pnpm run test:unit     # Vitest suite
corepack pnpm run test:playwright
```

## Fast UI preview loop

Use `dev:ui` for component-only work. It skips Electron, native helpers, the daemon,
and production application sagas. Use `dev:web` when the full browser renderer or a
client connection is required. Use `dev:cdp` for Electron main, preload, native,
window, or shell behavior.

From the monorepo root, run `make ports`, then start `make dev-sandbox-ui` as a
workspace service script. The target installs locked dependencies when needed and uses
the worktree's derived `DEV_PORT`, avoiding collisions with concurrent workspaces. An
explicit `DEV_PORT` override remains available when needed.

Use these exact state names in direct URLs:

- `/sandbox/button?state=default`, `loading`, `disabled`, or `destructive`
- `/sandbox/mention-agent-avatar?state=idle`, `waiting`, or `error`
- Add `theme=system|light|dark`, an integer `width=240..1600`, and
  `motion=full|reduced`. Example:
  `/sandbox/button?state=loading&theme=dark&width=420&motion=reduced`.

On the sandbox page, use `window.__INTENT_PREVIEW__.list()` to find preview IDs,
`await window.__INTENT_PREVIEW__.states('button')` to find states, and
`window.__INTENT_PREVIEW__.current()` to inspect the active ready state. Wait for
`[data-preview-ready=true]` before capture.

### Put a preview screenshot in user chat

Use an owned hidden embedded-browser tab with a fixed viewport. Call
`ws.browser.listTabs` first and reuse a matching tab; otherwise call
`ws.browser.openTab` with the preview URL under
`http://daemon.localhost:<DEV_PORT>/`. Wait no more than 15 seconds for
`[data-preview-ready=true]`. Confirm that
`window.__INTENT_PREVIEW__.current()` has the expected state and `status: 'ready'`.
Then call the browser `screenshot` action. A successful action returns image content;
keep that image block in the user response. A local file path alone does not show the
image in chat.

The embedded-browser path is the remote-host default. `playwright-cli` is typically
absent on remote hosts; use it only as a local fallback if the browser screenshot call
reaches its 30-second limit. Do not retry the same stalled browser call. In a new,
clean local session, set a fixed viewport, wait up to 15 seconds for the ready marker,
and write one PNG under `.demo-artifacts/<timestamp>-<flow>/`. Check that the PNG is
non-empty and has the expected dimensions, inspect it with an image-capable file
viewer, and close the clean session. Do not commit the media, load saved browser state,
or inspect cookies, credentials, or unrelated tabs.

Before linking any generated image or video, verify that the actual file exists in the
message's owning workspace. Use its exact workspace-relative path or its contained
absolute workspace path. Never invent an `artifacts/...` path, substitute a similarly
named file, or read a sibling workspace. If the expected artifact is absent, report it
as missing instead of emitting a link.

```bash
playwright-cli -s=ui-preview-chat open 'http://127.0.0.1:<DEV_PORT>/sandbox/button?state=destructive&theme=dark&width=420&motion=reduced'
playwright-cli -s=ui-preview-chat resize 1100 850
playwright-cli -s=ui-preview-chat run-code 'async page => { await page.locator("[data-preview-ready=true]").waitFor({ timeout: 15000 }); }'
playwright-cli -s=ui-preview-chat screenshot --filename=.demo-artifacts/<run>/preview.png --hires
playwright-cli -s=ui-preview-chat console error
playwright-cli -s=ui-preview-chat close
```

Call `ws.browser.listTabs` before `ws.browser.openTab` and reuse a matching URL. New
agent tabs are hidden by default and can still be evaluated, inspected, and captured.
Keep the tab open so Vite HMR updates it after source edits. Use `ws.browser.showTab`
to reveal it for human review; add `focus: true` only when focus is wanted. Use
`http://daemon.localhost:<DEV_PORT>` in `ws.browser` URLs so local and remote daemon
setups resolve correctly.

For focused browser validation, run:

```bash
corepack pnpm run test:ct -- src/features/agent/components/agent-avatar/__tests__/agent-avatar-waiting.ct.spec.ts
```

The CT harness defaults to port 3100 (the `CT_PORT` env var overrides it). Stop the
process on that port before retrying if it is occupied. The full workflow is in
`../../docs/fe/DEVELOPER_GUIDE.md#fast-ui-preview-workflow`.

## Dogfooding a dev FE against a daemon

The monorepo ships a source-only dev shim — `scripts/uds-ws-bridge.mjs`, run as
`make uds-to-unauthed-wss-bridge` from a monorepo checkout (not shipped in any package) —
that exposes the installed production intentd's UDS socket as an **UNAUTHENTICATED**
plain `ws://` endpoint on `127.0.0.1:51337/ws` (`BRIDGE_PORT` / `INTENTD_SOCKET`
override the defaults). It lets a dev FE debug against the real daemon without touching
the daemon's auth posture (UDS + authed WSS for iOS stay as-is). Loopback-only is by
design — the bridge refuses non-loopback binds, and while it runs the full
unauthenticated daemon API is on that port — never expose it beyond localhost.

### Loop A — web build in an embedded tab (primary; renderer/UI work)

From the monorepo root, choose the smallest one-command sandbox and run it as a
workspace service script:

- `make dev-sandbox-ui` — component previews, with no daemon.
- `make dev-sandbox-app` — the complete web renderer against the installed Intent
  daemon (or `INTENTD_SOCKET`).
- `make dev-sandbox-stack` — a dev-profile intentd build on isolated `.dev/` state plus
  the renderer. Use `INTENTD_PROFILE=release` to opt into a release build or
  `INTENTD_BIN=/path/to/intentd` to skip the build and use a prebuilt binary.

Run `make doctor` first for the stack path. It intentionally exits nonzero for missing
required prerequisites, including `pkg-config` plus OpenSSL development headers
(`libssl-dev` and `pkg-config` on Debian/Ubuntu). Do not bypass that check.

The remote-first Loop A is:

1. Start the chosen `dev-sandbox-*` workspace service and wait for its exact
   `Sandbox ready:` line. App and stack pre-warm the Vite module graph before printing
   that line.
2. Read the service status `detectedUrl`, keep its port, and call
   `ws.browser.listTabs`. Reuse a matching tab or call `ws.browser.openTab` with
   `http://daemon.localhost:<port>/` (plus any route/query).
3. Poll the tab for the expected DOM or accessibility content. A first tunneled open of
   a fresh pre-warmed app takes roughly one to three minutes to hydrate depending on host
   load (fastest observed: about 45 seconds). If only the splash is visible, keep polling;
   do not restart the service. Subsequent loads are fast; before pre-warming, a cold
   tunneled load took about 10 minutes.
4. Capture a browser screenshot, set the representative image as the workspace status
   image, and call `ws.browser.showTab` without focus so the human can inspect the live
   tab. Keep it open for HMR while editing.

Always use `http://daemon.localhost:<port>` for embedded-browser URLs. Same-machine
setups resolve to loopback; remote setups automatically create one tunnel for the page
and its same-origin `/intentd/ws` daemon connection. The app and stack Vite origin
exposes the full unauthenticated daemon API, so keep it loopback-only and open it only
through the client tunnel.

Tunneled Chromium treats `daemon.localhost` as a remote origin. Consequently,
`workspace-file://` media do not load in that embedded tab even though they load in
Electron; validate such media in an Electron build.

### Show your work after visible changes

Capture one representative embedded-browser screenshot and set it as the workspace
status image with `ws.workspace.setStatusImage`. Then call `ws.browser.showTab` without
`focus: true` so the human can click through the live HMR tab without having focus
stolen.

### Loop B — dev Electron FE + CDP (Electron shell work)

When the change touches Electron main/preload/native/sidecar, Loop A cannot see it —
run the dev Electron FE on a machine with a display using `pnpm run dev:cdp` (sets
`ENABLE_CDP_DEBUG=true`; remote-debugging port 9223 by default — the launcher picks the
first free port from 9223, so read the actual value from its output, e.g.
`CDP targets: http://127.0.0.1:<port>/json/list` — and every webContents — app window
and embedded tabs — is a target) and attach CDP locally. See
`../../docs/fe/CDP_MCP_TOOLS.md`. This loop is unavailable on a headless remote host.

### Caveats

- The web build has no Electron preload: daemon RPCs work over the WS transport, but
  Electron-only capabilities (native dialogs, window management, some IPC-bridged
  channels) are absent or mocked — Loop A covers renderer/UI work only.
- `browser.exec` reaches embedded tabs only, never the app's own chrome — inspecting
  the Electron shell itself is always Loop B/CDP.

## PR test builds

`.github/workflows/manual-signed-build.yml` ("Manual Signed Build") is dispatch-only and
builds any branch/ref — e.g. a PR branch — into platform-specific installers for testing:
`gh workflow run manual-signed-build.yml --ref <pr-branch> -f build_macos=true` (also
`build_windows` / `build_linux`; `sign` defaults to true — macOS Developer ID +
notarization, Windows DigiCert). Add `-f intentd_ref=<hash>` (any intent-hq/intentd git
ref — full 40-char commit SHA, branch, or tag; `actions/checkout` cannot resolve an
abbreviated SHA from `git log --oneline`) to build the intentd sidecar from source at
that ref instead of fetching the pinned release (all legs: macOS, Windows, and both
Linux arches); the run summary reports the resolved intentd SHA. Empty/omitted
`intentd_ref` keeps today's pinned-release fetch.
Output is installers + blockmaps only, uploaded as
short-lived workflow artifacts (7-day retention), version-suffixed `-manual.<run_number>`.
Nothing publishes to intent-hq/cloudlands-releases and no auto-updater manifest is
produced — manual install/testing only.

## Verification

Use `pnpm run verify:changed -- <paths...>` during local work. With no paths, it reads
staged, unstaged, deleted, and untracked frontend files. Add `--dry-run` to inspect the
selected commands without running them. The command runs scoped Prettier and ESLint,
related Vitest tests, directly imported colocated component tests, and only the
renderer/main/preload TypeScript boundaries that changed. Ambiguous or high-risk files
select a conservative suite instead of silently skipping coverage.

Expensive component and type checks share a host-wide lock. The command waits for at
most 30 seconds by default and never stops the process that owns the lock. Set
`VERIFY_CHANGED_LOCK_TIMEOUT_MS` to a bounded value of at most 300000 when a longer
queue is useful.

After any structural change (moving files, changing imports, extracting modules):

```bash
pnpm vitest run <targeted-test-files>
pnpm run check                              # Svelte + TypeScript consumers
pnpm tsc -p tsconfig.json --noEmit          # renderer
pnpm tsc -p tsconfig.main.json --noEmit     # main process
pnpm tsc -p tsconfig.preload.json --noEmit  # preload
```

`pnpm run check` must run alongside plain `tsc` because Svelte component consumers are not fully type-checked by `tsc` alone. All three typechecks must pass. The main typecheck requires `pnpm run generate:build-config` to have been run at least once.

## Frontend philosophy & testing

The renderer is a **thin presenter** over the daemon. Correctness, business rules, and
persistence live in `intentd`; the FE renders what the daemon sends and dispatches user
intent back. The wire contract is the monorepo's
[`docs/PROTOCOL.md`](../../docs/PROTOCOL.md) (the relative link resolves in a
monorepo checkout, where this repo mounts at `packages/cloudlands-fe/`);
treat it as the single source of truth.

### Less logic on the client

- Keep business/domain logic out of the renderer. Selectors, components, and sagas should
  shape and route data — not re-derive things the BE already decides.
- New behaviour that affects domain state belongs in `intent-services` (or the relevant
  crate) on the BE, not in a renderer transform.
- Reducers/sagas exist to coordinate UI flows around wire calls; they are not a place to
  re-implement server semantics.

### Faithfully reproduce BE state

- Render exactly what the daemon sends. Do **not** heal, patch, normalize, or transform
  BE-owned payloads on the way in — no defensive defaults to mask missing fields, no
  client-side "fixups" of shapes, no quiet renames.
- Any wire mismatch is resolved at the **diverging side** versus the monorepo's
  `docs/PROTOCOL.md`: the BE is the preferred fix-site (it owns the
  contract), or PROTOCOL.md is updated when the documented shape itself is wrong. The FE
  is never bent to silently absorb a divergence.
- Recent example: `tool_use` and `tool_result` blocks must pair by
  `toolCallId ↔ tool_use_id` per PROTOCOL.md §7 (`chat.subscribe` synthesized blocks).
  When pairing broke, the **FE selector** was corrected to match the contract — the BE
  was not coerced into emitting a renamed field.

### Transient client state

- Renderer state is **transient/UI-only**: panel layout, selection, drafts, hover/focus,
  open menus, in-flight optimistic ticks. None of it is canonical.
- The BE owns persistence and durable identity. After a reload, the FE rehydrates by
  asking the daemon — it does not reconstruct domain state from local caches as if those
  caches were authoritative.
- Caches in the renderer are read-through views of BE responses, invalidated by BE-driven
  events, never an alternative source of truth.

### Event-driven refetches — single-flight and coalesced

Daemon events arrive in bursts (agent lifecycle, file changes, task updates). Any handler
that refetches state in response to daemon events **MUST** be single-flight with trailing
coalesce:

- **Single-flight**: all triggers share one in-flight promise — never start a second
  concurrent refetch of the same data.
- **Trailing coalesce**: events arriving while a refetch is in flight collapse into at
  most **one** trailing refetch after the current one settles. The leading edge stays
  immediate (the first event triggers a fetch right away) so freshness is not sacrificed.
- N events during a fetch must produce at most 1 follow-up fetch, not N.

Do **not** fan out per-workspace daemon RPC loops from an event handler — e.g.
`workspace.list` followed by a per-workspace RPC for each result multiplies every event
burst into `O(workspaces)` daemon calls (precedent:
[intent-hq/monorepo#1395](https://github.com/intent-hq/monorepo/issues/1395), the
active-streams fan-out). Prefer a targeted query for the affected workspace, or a
daemon-side aggregate that returns everything in one RPC — if none exists, request one
on the BE rather than looping on the client.

### Saga-owned mutations & soft-hide-then-commit

Some async-action triggers (`*Requested` actions with a `.promise`) lost their handlers
when the saga runtime was removed. They are re-homed in a **mutation middleware** rather
than a new saga: `createAgentMutationMiddleware()` in
`src/features/agent/agent-mutation-service.ts` observes dispatched actions and, after the
reducer runs, calls the `AppClient` seam and dispatches the per-dispatch
`action.success`/`action.failure` so the awaited promise settles. Keep these middlewares
dependency-light (no selector imports — they evaluate `store.createSelector` at chain
construction); read state directly off `appStore.state` and import the toast lib lazily.

Agent **deletion** uses the **daemon-owned delete grace window** (PROTOCOL §5.5, v6.7+;
the handlers live in the agent mutation saga):

- `deleteAgentWithUndoRequested` **soft-hides** the session locally (drops it from the
  visible list) and sends `agent.delete { undoDelayMs: 15000 }` **immediately**, so the
  daemon owns the 15s window and commits at the deadline even if the FE quits or crashes
  mid-window. The action resolves with the removed session once the daemon acks the
  schedule; a wire failure un-hides the session and rejects.
- `undoAgentDeletionRequested` issues the race-safe `agent.cancelDelete`:
  `{ cancelled: true }` un-hides the session; `{ cancelled: false }` (already committed)
  surfaces a "could not undo" toast without resurrecting it.
- There is **no FE-side commit timer or flush** — the daemon commits at the deadline and
  emits `agent:deleted` (in `AGENT_LIFECYCLE_EVENTS`), so the reactive `subscribe`
  refetch reconciles the list — the FE does not hand-roll list mutation.

The pending deletions are transient UI-only state (a module-level `Map`), never Redux.
During the window (and for a tombstone grace period after the deadline, so stale
refetches cannot resurrect the agent) read paths consult `isAgentDeletionPending()` and
drop wire rows carrying the additive `pendingDeleteAt` field.

### Test observable behavior, not presentation

- Tests **MUST** cover observable logic: state transitions, inputs/outputs and wire
  payloads, validation, conditional behavior, routing, error/retry handling, persistence,
  and accessibility interactions/state.
- Tests **MUST** establish runtime or behavioral evidence against an independent oracle.
  Expectations derived from the implementation under test are circular and prohibited.
- Do **not** assert literal source, class, or markup spelling, source order, exact copy, or
  unconditional visual presence.
- Do **not** stub or assign dimensions, values, or state and then assert those same inputs.
  Exercise production behavior and observe its resulting output or runtime state.
- Do **not** duplicate production values in a fixture and test only that duplicate. A
  fixture must drive production code or independently model the external contract.
- Exact-value assertions are appropriate for intentional stable contracts, including wire
  payloads, schemas, public identifiers, and accessibility state.
- Accessible text may locate a control in a behavioral test; assert the resulting
  interaction or state, not the exact wording as the contract.
- For copy-only changes, do not update unit tests. Run `pnpm run generate:i18n`,
  `pnpm run lint:i18n-completeness`, and `pnpm run lint:i18n-strings` instead.

### Testing — every feature/fix against a mock BE

Every feature and every bug fix that touches the wire **MUST** ship with tests that:

1. **Assert the exact request sent on the wire** — channel/method plus the params payload
   — matching the request shape PROTOCOL.md defines for that method.
2. **Feed a PROTOCOL.md-shaped mock response** back through the same channel and assert
   the FE handles it (state updates, rendered output, downstream events).

Responses that diverge from PROTOCOL.md are fixed at the **BE** (or PROTOCOL.md is
updated); the FE never silently absorbs a wire mismatch in a test fixture either — mock
payloads must mirror the documented contract.

Reuse the existing infrastructure instead of inventing parallel harnesses:

| Use…                                               | For…                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/shared/ipc-mock-router.ts`                    | Single in-memory mock router — register per-channel `invoke` handlers and emit mock events.          |
| `src/shared/ipc/request-validation.ts` (+ schemas) | Zod schemas + `validateIpcRequest` / `tryValidateIpcRequest` to assert the request matches contract. |
| `src/shared/ipc/__tests__/contracts.test.ts`       | Reference pattern for asserting IPC contracts and request schemas — extend it for new methods.       |
| `src/test-setup.ts`                                | Vitest global setup (Electron mocks, jsdom shims, temp workspace dir). New suites get this for free. |

Run the targeted suite with `pnpm vitest run <files>` (see [Verification](#verification)
above) before opening a PR.

## Filing issues

File bugs on [intent-hq/intent](https://github.com/intent-hq/intent/issues) — the
single tracker for all components; never track issues in markdown files. Label with
`component:fe` + `agent-filed`. See the root [`AGENTS.md`](../../AGENTS.md) → Filing
Issues for the full conventions (dedup, cross-referencing, `Fixes intent-hq/intent#N` —
the release notifier `scripts/notify-fixed-issues.sh` comments on the issue once a
release fully delivers the fix, i.e. every linked fix PR across cloudlands-fe and
intentd is merged and contained in the released versions).

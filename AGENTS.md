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

| Working on…         | Open                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| agents              | ../../docs/fe/agent-message-dedup-and-stream-sagas.md, ../../docs/fe/RULES_SYSTEM.md       |
| state/store         | ../../docs/fe/STATE_MANAGEMENT.md, src/store/renderer/docs/                                |
| component design    | ../../docs/fe/COMPONENTS_DESIGN.md                                                         |
| panels/layout       | ../../docs/fe/panel-system-refactoring.md, ../../docs/fe/PANEL_TAB_UX_SPEC.md              |
| PR descriptions     | ../../docs/fe/PR_DESCRIPTION_GUIDE.md                                                      |
| browser/CDP         | ../../docs/fe/BROWSER_PANEL_SPEC.md, ../../docs/fe/CDP_MCP_TOOLS.md                        |
| module boundaries   | ../../docs/fe/MODULE_BOUNDARY_GUIDE.md                                                     |
| debugging           | ../../docs/fe/TROUBLESHOOTING_GUIDE.md, ../../docs/fe/IPC_DEBUG_GUIDE.md                   |
| error handling      | ../../docs/fe/ERROR_HANDLING_SYSTEM.md                                                     |
| TypeScript/types    | ../../docs/fe/TYPE_SYSTEM_GUIDE.md                                                         |
| events/IPC          | ../../docs/fe/EVENT_SYSTEM.md                                                              |
| keybindings         | ../../docs/fe/KEYBINDINGS.md                                                               |
| deploying/releasing | ../../docs/fe/DEPLOYING.md                                                                 |

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
- **Never quote the literal breaking-change footer token** — release-please treats `BREAKING CHANGE:` / `BREAKING-CHANGE:` (and `Release-As:`) appearing anywhere in a commit body as a real footer, and squash merges fold every branch commit message into the squash body, so a commit that merely *quotes* the token causes a false major bump (or, for `Release-As:`, a forced pinned version); this accidentally cut v3.0.0 — see intent-hq/monorepo#2988. Never write the literal token in commit messages, PR titles/bodies, or review comments unless an actual breaking change is intended — when describing the mechanism, write "the breaking-change footer token" or similar instead.

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
pnpm run dev           # Standard development launcher
pnpm run dev:cdp       # Development with CDP support
pnpm run build         # Production build
pnpm run check         # Svelte + TypeScript checks
pnpm run lint          # ESLint
pnpm run format        # Prettier
pnpm run test:unit     # Vitest suite
pnpm run test:playwright
```

## Dogfooding a dev FE against the production daemon (UDS→WS bridge)

The monorepo ships a source-only dev shim — `scripts/uds-ws-bridge.mjs`, run as
`make uds-to-unauthed-wss-bridge` from a monorepo checkout (not shipped in any package) —
that exposes the installed production intentd's UDS socket as an **UNAUTHENTICATED**
plain `ws://` endpoint on `127.0.0.1:51337/ws` (`BRIDGE_PORT` / `INTENTD_SOCKET`
override the defaults). It lets a dev FE debug against the real daemon without touching
the daemon's auth posture (UDS + authed WSS for iOS stay as-is). Loopback-only is by
design — the bridge refuses non-loopback binds, and while it runs the full
unauthenticated daemon API is on that port — never expose it beyond localhost.

### Loop A — web build in an embedded tab (primary; renderer/UI work)

Live-proven flow (zero FE changes needed):

1. From the monorepo root: `make uds-to-unauthed-wss-bridge` → bridge on
   `ws://127.0.0.1:51337/ws`.
2. `VITE_INTENTD_WS_URL=ws://127.0.0.1:51337/ws pnpm dev:web` — with no Electron preload
   the renderer selects the browser WebSocket transport and speaks JSON-RPC directly
   over the bridge (plain `ws://` is accepted for loopback hosts only; anything else
   needs `wss://`).
3. Open the vite dev URL in an embedded tab of the running packaged app via
   `browser.exec` (`openTab` / `navigate`) using an `http://daemon.localhost:<port>`
   URL, then drive the tab with `screenshot` / `evaluate` / `getAccessibilityTree`.
   Humans can eyeball the same tab. REV-1 first-client stickiness is a feature here:
   the reverse call lands on the packaged app, which hosts the tab.

Always give `browser.exec` `http://daemon.localhost:<port>` URLs and let the client
resolve them: same-machine setups rewrite to `127.0.0.1`; with a **remote daemon** the
embedded tab renders on the client machine, and an unreachable daemon-loopback port is
automatically tunneled (`openTab`/`navigate` echo `tunneled: true` plus the client-local
forward URL). In the remote case the page itself also dials the bridge from the client,
so mint a forward for the bridge port first — open a tab to
`http://daemon.localhost:51337/`, read the client-local port from the tunneled echo (the
tab shows the bridge's HTTP 400 "This is a WebSocket endpoint" body — that error page is
the success signal, the forward is minted regardless) — and restart dev:web with
`VITE_INTENTD_WS_URL=ws://127.0.0.1:<client-local-port>/ws`.
Expect a slow cold load over the tunnel (dev mode serves ~250 module requests).

Tunnel forwards are **persistent** — the minted `localPort` is stable, so baking it into
`VITE_INTENTD_WS_URL` is safe. Whether minted explicitly (`openTunnel`) or implicitly
(the `openTab`/`navigate` fallback above), a forward has no idle expiry and survives
`/tunnel` WebSocket drops: the local listener (and its port) stays open and the next
accepted connection lazily reconnects the tunnel. A forward closes only on explicit
`closeTunnel`, a backend switch (forwards target the old daemon's loopback), app quit,
or — for forwards minted on behalf of a workspace — when every owning workspace has been
archived or deleted (refcounted; a port shared by several workspaces closes with the
last owner, and forwards minted with no workspace are app-lifetime). One exception: a
definitively connection-refused daemon-side port (e.g. the bridge process died) drops
that forward immediately — re-run `openTunnel` (or the openTab probe) to re-mint it.

### Loop B — dev Electron FE + CDP (Electron shell work)

When the change touches Electron main/preload/native/sidecar, Loop A cannot see it —
run the dev Electron FE on the daemon machine with `pnpm run dev:cdp` (sets
`ENABLE_CDP_DEBUG=true`; remote-debugging port 9223 by default — the launcher picks the
first free port from 9223, so read the actual value from its output, e.g.
`CDP targets: http://127.0.0.1:<port>/json/list` — and every webContents — app window
and embedded tabs — is a target) and attach CDP locally. See
`../../docs/fe/CDP_MCP_TOOLS.md`.

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
notarization, Windows DigiCert). Output is installers + blockmaps only, uploaded as
short-lived workflow artifacts (7-day retention), version-suffixed `-manual.<run_number>`.
Nothing publishes to intent-hq/cloudlands-releases and no auto-updater manifest is
produced — manual install/testing only.

## Verification

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

| Use…                                              | For…                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/shared/ipc-mock-router.ts`                   | Single in-memory mock router — register per-channel `invoke` handlers and emit mock events.       |
| `src/shared/ipc/request-validation.ts` (+ schemas)| Zod schemas + `validateIpcRequest` / `tryValidateIpcRequest` to assert the request matches contract. |
| `src/shared/ipc/__tests__/contracts.test.ts`      | Reference pattern for asserting IPC contracts and request schemas — extend it for new methods.    |
| `src/test-setup.ts`                               | Vitest global setup (Electron mocks, jsdom shims, temp workspace dir). New suites get this for free. |

Run the targeted suite with `pnpm vitest run <files>` (see [Verification](#verification)
above) before opening a PR.

## Filing issues

File bugs on [intent-hq/monorepo](https://github.com/intent-hq/monorepo/issues) — the
single tracker for all components; never track issues in markdown files. Label with
`component:fe` + `agent-filed`. See the root [`AGENTS.md`](../../AGENTS.md) → Filing
Issues for the full conventions (dedup, cross-referencing, `Fixes intent-hq/monorepo#N` —
the release notifier `scripts/notify-fixed-issues.sh` comments on the issue once a
release fully delivers the fix, i.e. every linked fix PR across cloudlands-fe and
intentd is merged and contained in the released versions).

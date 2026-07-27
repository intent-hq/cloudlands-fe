# Agents

Quick routing guide for AI agents. Start here, then open the smallest relevant doc.

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

| Working on…         | Open                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| agents              | docs/AGENT_ARCHITECTURE.md                                            |
| state/store         | docs/STATE_MANAGEMENT.md, src/store/renderer/docs/                    |
| UI components       | docs/COMPONENT_RESPONSIBILITIES.md                                    |
| component design    | docs/COMPONENTS_DESIGN.md                                             |
| panels/layout       | docs/panel-system-refactoring.md, docs/proposals/PANEL_TAB_UX_SPEC.md |
| PR descriptions     | docs/PR_DESCRIPTION_GUIDE.md                                          |
| browser/CDP         | docs/BROWSER_PANEL_SPEC.md, docs/CDP_MCP_TOOLS.md                     |
| module boundaries   | docs/MODULE_BOUNDARY_GUIDE.md                                         |
| debugging           | docs/TROUBLESHOOTING_GUIDE.md, docs/IPC_DEBUG_GUIDE.md                |
| error handling      | docs/ERROR_HANDLING_SYSTEM.md                                         |
| TypeScript/types    | docs/TYPE_SYSTEM_GUIDE.md                                             |
| events/IPC          | docs/EVENT_SYSTEM.md                                                  |
| keybindings         | docs/KEYBINDINGS.md                                                   |
| deploying/releasing | docs/real/DEPLOYING.md                                                |

## Key conventions

- **Svelte stores are DEPRECATED** — All `.store.svelte.ts` files are migration targets. New shared/domain state MUST use Redux slices + sagas (ephemeral component-local UI state is fine without Redux). If refactoring encounters `.store.svelte.ts` usage, do not expand or entrench it — follow the [Migration Guide](src/store/renderer/docs/MIGRATION_GUIDE.md) to move toward complete store removal. See `docs/STATE_MANAGEMENT.md`.
- Use `pnpm`, not `npm`.
- Put renderer product work in `src/features/`; shared utilities live in `src/lib/`.
- Create agents via `agentFactory.createAgent()`.
- Keep shared app state in `src/store/renderer/`, not ad-hoc component state.
- **Selector readables belong at component init only** — `selector()` uses Svelte context and must not run in event handlers or callbacks. Dispatch actions and perform one-time selector reads through the configured app `Store` instance, e.g. `store.dispatch(action)` and `selector.select(store.state, ...args)`. See `docs/STATE_MANAGEMENT.md` for details.
- **Never import from a feature's **`main/`** subtree in renderer code** (or vice-versa).
- **Don't export utility functions from orchestration modules** — extract to a dedicated `utils/` file.
- **Keep utilities dependency-light** — no stores, services, or side effects.

## Internationalization (i18n)

All user-facing strings (labels, aria-labels, placeholders, tooltips, toasts, errors, menu items) go through Paraglide message functions — never hardcode them.

- **Messages**: call `m.*()` (import from `src/shared/paraglide/messages.js`); keys live in `messages/en.json`. Key naming: `{feature}_{component}_{purpose}`, camelCase segments, role suffixes `_label` / `_description` / `_placeholder` / `_ariaLabel` / `_tooltip` / `_error` (e.g. `settings_wsApi_port_invalid`).
- The compiled output (`src/shared/paraglide/`) is **gitignored** — run `pnpm run generate:i18n` after editing `messages/en.json`.
- **Interpolation over concatenation**: named params (`"Configure {name} path"`); sentences split by inline markup use `_before` / `_middle` / `_after` key pairs; plurals as `_one` / `_many` key pairs. Gotcha: literal `{`/`}` in a message parses as a parameter — rephrase such strings.
- **Dates/numbers**: only via `$lib/i18n/format` (renderer) or `src/shared/i18n/formatters.ts` (main/shared) — never ad-hoc `toLocaleString`, direct `date-fns` format calls, or string-built numbers/percentages.
- **Module-scope constants** holding localized text use property getters (`get description() { return m.…() }`) so strings re-evaluate on locale change; identifier-bearing fields stay literal.
- **Exemptions** — log lines, wire/IPC constants, agent-generated content, brand names, file paths, URLs, shell commands — mark with `// i18n-ignore (reason)` or `<!-- i18n-ignore (reason) -->` on the same line or the line above.
- **Enforcement**: `scripts/check-hardcoded-strings.mjs` (chained into `pnpm run lint`) blocks hardcoded strings inside `ENFORCED_DIRS`. New features in enforced dirs must be string-free from day one; when you migrate a directory to messages, add it to `ENFORCED_DIRS`. A catalog-completeness CI check (planned) will additionally fail on keys missing from non-English locales.
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

### Mutation middleware & soft-hide-then-commit

Some async-action triggers (`*Requested` actions with a `.promise`) lost their handlers
when the saga runtime was removed. They are re-homed in a **mutation middleware** rather
than a new saga: `createAgentMutationMiddleware()` in
`src/features/agent/agent-mutation-service.ts` observes dispatched actions and, after the
reducer runs, calls the `AppClient` seam and dispatches the per-dispatch
`action.success`/`action.failure` so the awaited promise settles. Keep these middlewares
dependency-light (no selector imports — they evaluate `store.createSelector` at chain
construction); read state directly off `appStore.state` and import the toast lib lazily.

Agent **deletion** uses a **soft-hide-then-commit** pattern (the handlers live in that
same middleware):

- `deleteAgentWithUndoRequested` optimistically **soft-hides** the session locally (drops
  it from the visible list) **without** calling the daemon, shows an Undo toast, and arms a
  15s commit timer. The action resolves immediately with the removed session.
- `undoAgentDeletionRequested` cancels the timer and **un-hides** the session — no daemon
  call, because the delete was never sent.
- `commitPendingAgentDeletionRequested` / `flushPendingAgentDeletionsRequested` (and the
  timer elapsing) call the real `appClient.agents.delete` (`agent.delete`, PROTOCOL §5.5).
  On success the daemon emits `agent:deleted` (in `AGENT_LIFECYCLE_EVENTS`), so the
  reactive `subscribe` refetch reconciles the list — the FE does not hand-roll list
  mutation. On failure the session is un-hidden and the error surfaced.

Why not a true undo? Once `agent.delete` reaches the daemon the deletion is permanent, so
"undo" can only exist **before** commit. Deferring the wire call for the undo window is the
only way to offer undo without a daemon-side restore path. The pending deletions are
transient UI-only state (a module-level `Map`), never Redux.

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
| `tests/mocks/ipc.mock.ts` (`IPCMock`)             | Higher-level mock with handler/event-listener tracking when a test needs richer choreography.     |
| `src/test-setup.ts`                               | Vitest global setup (Electron mocks, jsdom shims, temp workspace dir). New suites get this for free. |

Run the targeted suite with `pnpm vitest run <files>` (see [Verification](#verification)
above) before opening a PR.

## Filing issues

When you encounter a bug or limitation while working on this codebase, file a GitHub
issue on [intent-hq/monorepo](https://github.com/intent-hq/monorepo/issues) — the single
tracker for all components. Do not track issues in markdown files.

- **Labels**: apply the appropriate `component:*` label (`component:fe` for this repo)
  plus `agent-filed`.
- **Aggressive dedup**: search existing issues first
  (`gh issue list --repo intent-hq/monorepo --search "<keywords>" --state all`) and
  comment on / link the existing issue instead of filing a duplicate.
- **Cross-reference**: reference the issue number in related commits/PRs (e.g.
  `fix: correct panel focus (#123)`).

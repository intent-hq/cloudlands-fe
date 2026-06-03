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

| Working on… | Open |
| --- | --- |
| agents | docs/AGENT_ARCHITECTURE.md |
| state/store | docs/STATE_MANAGEMENT.md, src/store/renderer/docs/ |
| UI components | docs/COMPONENT_RESPONSIBILITIES.md |
| component design | docs/COMPONENTS_DESIGN.md |
| panels/layout | docs/panel-system-refactoring.md, docs/proposals/PANEL_TAB_UX_SPEC.md |
| PR descriptions | docs/PR_DESCRIPTION_GUIDE.md |
| browser/CDP | docs/BROWSER_PANEL_SPEC.md, docs/CDP_MCP_TOOLS.md |
| module boundaries | docs/MODULE_BOUNDARY_GUIDE.md |
| debugging | docs/TROUBLESHOOTING_GUIDE.md, docs/IPC_DEBUG_GUIDE.md |
| error handling | docs/ERROR_HANDLING_SYSTEM.md |
| TypeScript/types | docs/TYPE_SYSTEM_GUIDE.md |
| events/IPC | docs/EVENT_SYSTEM.md |
| keybindings | docs/KEYBINDINGS.md |
| deploying/releasing | docs/real/DEPLOYING.md |
| parallel runner | parallel-runner/docs/ |

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
pnpm tsc -p tsconfig.json --noEmit          # renderer
pnpm tsc -p tsconfig.main.json --noEmit     # main process
pnpm tsc -p tsconfig.preload.json --noEmit  # preload
```

All three typechecks must pass. The main typecheck requires `pnpm run generate:build-config` to have been run at least once.
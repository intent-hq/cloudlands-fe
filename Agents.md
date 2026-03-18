# Agents.md

Quick routing guide for AI agents. Start here, then open the smallest relevant doc.

## Tech stack
- Electron + SvelteKit + TypeScript desktop app
- Svelte 5 runes in the UI; shared app state uses Redux + sagas
- Use `pnpm`; create agents via `agentFactory.createAgent()`

## Project layout
```text
.
├── ./docs/
├── ./scripts/
├── ./src/
│   ├── ./src/features/         # Feature-first renderer modules
│   │   ├── ./src/features/agent/
│   │   ├── ./src/features/browser/
│   │   └── ./src/features/layout/
│   ├── ./src/lib/
│   ├── ./src/main/
│   ├── ./src/preload/
│   ├── ./src/shared/
│   └── ./src/test/
└── ./package.json
```

## Where to look
| Working on… | Open |
| --- | --- |
| agents | [`./docs/AGENT_ARCHITECTURE.md`](./docs/AGENT_ARCHITECTURE.md) |
| state/store | [`./docs/STATE_MANAGEMENT.md`](./docs/STATE_MANAGEMENT.md), [`./src/lib/store/docs/`](./src/lib/store/docs/), [`./src/lib/store/docs/readme.md`](./src/lib/store/docs/readme.md) |
| UI components | [`./docs/COMPONENT_RESPONSIBILITIES.md`](./docs/COMPONENT_RESPONSIBILITIES.md) |
| panels/layout | [`./docs/panel-system-refactoring.md`](./docs/panel-system-refactoring.md), [`./docs/proposals/PANEL_TAB_UX_SPEC.md`](./docs/proposals/PANEL_TAB_UX_SPEC.md) |
| browser/CDP | [`./docs/BROWSER_PANEL_SPEC.md`](./docs/BROWSER_PANEL_SPEC.md), [`./docs/CDP_MCP_TOOLS.md`](./docs/CDP_MCP_TOOLS.md) |
| debugging | [`./docs/TROUBLESHOOTING_GUIDE.md`](./docs/TROUBLESHOOTING_GUIDE.md), [`./docs/IPC_DEBUG_GUIDE.md`](./docs/IPC_DEBUG_GUIDE.md) |
| error handling | [`./docs/ERROR_HANDLING_SYSTEM.md`](./docs/ERROR_HANDLING_SYSTEM.md) |
| TypeScript/types | [`./docs/TYPE_SYSTEM_GUIDE.md`](./docs/TYPE_SYSTEM_GUIDE.md) |
| events/IPC | [`./docs/EVENT_SYSTEM.md`](./docs/EVENT_SYSTEM.md) |
| keybindings | [`./docs/KEYBINDINGS.md`](./docs/KEYBINDINGS.md) |
| deploying/releasing | [`./docs/real/DEPLOYING.md`](./docs/real/DEPLOYING.md) |
| parallel runner | [`./parallel-runner/docs/`](./parallel-runner/docs/) |

## Key conventions
- Use `pnpm`, not `npm`.
- Put renderer product work in [`./src/features/`](./src/features/); shared utilities/components live in [`./src/lib/`](./src/lib/).
- Create agents via `agentFactory.createAgent()`.
- Keep shared app state in [`./src/lib/store/`](./src/lib/store/), not ad-hoc component state.

## Common commands
```bash
pnpm run dev           # Standard development launcher
pnpm run dev:cdp       # Development launcher with CDP support
pnpm run build         # Production build
pnpm run check         # Svelte + TypeScript checks
pnpm run lint          # ESLint
pnpm run format        # Prettier write pass
pnpm run test:unit     # Vitest suite
pnpm run test:playwright
```
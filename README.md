# Cloudlands FE

Electron + SvelteKit + TypeScript desktop frontend for the `intentd` daemon. It
is consumed as the `packages/cloudlands-fe` git submodule of
[intent-hq/monorepo](https://github.com/intent-hq/monorepo).

## Architecture

The renderer is a SvelteKit application running inside Electron. It never talks
to the backend directly. Instead, all backend access flows through a single
seam:

```
SvelteKit renderer  <->  AppClient (JSON-RPC boundary)  <->  intentd daemon
```

- **AppClient (`src/lib/client`)** is the only boundary the renderer uses to
  reach "the backend". Each domain exposes async query methods, reactive
  `subscribe()` streams, and mutation methods. It ships with two
  implementations behind the same contract:
  - a **live** implementation (`src/lib/client/live`) that speaks JSON-RPC to
    the `intentd` daemon over the IPC bridge, and
  - a **mock** implementation (`src/lib/client/mock`) backed by in-memory
    fixtures, so the app runs standalone without a daemon.
- **Shared / domain state uses Redux + redux-saga** under
  `src/store/renderer`. Svelte 5 runes are used for UI rendering only; they are
  not a home for shared or durable application state.
- **Node-bound code lives under feature `main/` subtrees.** The renderer and
  the Electron main process are a strict boundary: renderer code never imports
  from a feature's `main/` subtree, and vice versa.

## Getting started

### As part of the monorepo (recommended)

Cloudlands FE is normally developed as the `packages/cloudlands-fe` submodule of
the monorepo:

```bash
# Clone the monorepo with submodules
git clone --recurse-submodules https://github.com/intent-hq/monorepo.git

# …or, in an existing monorepo checkout, initialize just this submodule
git submodule update --init packages/cloudlands-fe

cd packages/cloudlands-fe
pnpm install
```

### Standalone

You can also clone and run this repository on its own (the app falls back to the
mock AppClient when no daemon is present):

```bash
git clone https://github.com/intent-hq/cloudlands-fe.git
cd cloudlands-fe
pnpm install
```

## Commands

Use `pnpm` (not `npm`). The following scripts are defined in `package.json`:

```bash
pnpm install            # Install dependencies
pnpm run dev            # Start the app in development (Vite + Electron)
pnpm run build          # Production build (renderer, main, preload)
pnpm run check          # svelte-check + TypeScript checks
pnpm run lint           # ESLint
pnpm run format         # Prettier (write)
pnpm run test:unit      # Vitest unit suite
pnpm run test:playwright # Playwright tests
```

## Project layout

```text
src/
├── shared/          # Cross-process utilities (main + renderer)
├── lib/             # Renderer-only shared utilities & components
│   └── client/      # AppClient JSON-RPC boundary (live + mock)
├── main/            # Electron main-process code & utilities
├── preload/         # Electron preload scripts
├── features/        # Feature-first renderer modules
│   └── <name>/
│       ├── utils/   # Feature-local utilities
│       └── main/    # Feature's main-process (Node-bound) code
├── routes/          # SvelteKit pages
├── store/
│   └── renderer/    # Redux slices + sagas (shared/domain state)
└── test/
```

See [`AGENTS.md`](./AGENTS.md) for the full conventions and routing guide.

## Documentation

Key references under [`docs/`](./docs):

- [AGENT_ARCHITECTURE.md](./docs/AGENT_ARCHITECTURE.md) — agent system
  architecture and design.
- [STATE_MANAGEMENT.md](./docs/STATE_MANAGEMENT.md) — Redux + saga state policy
  and the Svelte-store migration.
- [MODULE_BOUNDARY_GUIDE.md](./docs/MODULE_BOUNDARY_GUIDE.md) — renderer↔main
  and feature boundaries.
- [COMPONENT_RESPONSIBILITIES.md](./docs/COMPONENT_RESPONSIBILITIES.md) —
  component structure and ownership.
- [TYPE_SYSTEM_GUIDE.md](./docs/TYPE_SYSTEM_GUIDE.md) — TypeScript and type
  safety conventions.
- [EVENT_SYSTEM.md](./docs/EVENT_SYSTEM.md) — the unified event system.

## History

This repository is the frontend **ported from the prior Electron app** and
wired to the `intentd` daemon through the AppClient JSON-RPC boundary. It
**replaces the earlier Tauri v2 prototype** that previously occupied this repo.

# cloudlands-fe

Electron + SvelteKit + TypeScript desktop frontend for **Intent** that talks to
the `intentd` daemon. It is consumed as the `packages/cloudlands-fe` git
submodule of [intent-hq/monorepo](https://github.com/intent-hq/monorepo).

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

`cloudlands-fe` is normally developed as the `packages/cloudlands-fe` submodule
of the monorepo:

```bash
git clone https://github.com/intent-hq/monorepo.git
cd monorepo

# Initialize this submodule (some sibling submodules are still private,
# so initialize selectively rather than cloning with --recurse-submodules)
git submodule update --init --recursive packages/cloudlands-fe

cd packages/cloudlands-fe
pnpm install
pnpm run dev
```

Without a staged `intentd` sidecar, `pnpm run dev` falls back to the mock
AppClient. For the full stack, run `make dev` from the monorepo root, which
builds `intentd` and launches the app with it as a sidecar (see
[intentd sidecar pin](#intentd-sidecar-pin)).

### Standalone

You can also clone and run this repository on its own (the app falls back to the
mock AppClient when no daemon is present):

```bash
git clone https://github.com/intent-hq/cloudlands-fe.git
cd cloudlands-fe
pnpm install
pnpm run dev
```

## Commands

Use `pnpm` (not `npm`). The following scripts are defined in `package.json`:

```bash
pnpm install            # Install dependencies
pnpm run dev            # Start the app in development (Vite + Electron)
pnpm run build          # Production build (renderer, main, preload)
pnpm run check          # svelte-check (Svelte + TypeScript diagnostics)
pnpm run lint           # ESLint
pnpm run format         # Prettier (write)
pnpm run test:unit      # Vitest unit suite
pnpm run test:playwright # Playwright tests
```

## intentd sidecar pin

The bundled `intentd` sidecar is pinned to an **exact released version** in
[`intentd.version`](./intentd.version): a bare semver with no leading `v`,
matching a `vX.Y.Z` / `vX.Y.Z-beta.N` tag on
[intent-hq/intentd](https://github.com/intent-hq/intentd).

- **Bumping the pin**: edit `intentd.version` in a normal reviewable PR, then run
  `node scripts/fetch-sidecar.cjs` to confirm the release assets exist and verify.
- **Fetching the pinned sidecar**: `node scripts/fetch-sidecar.cjs` downloads the
  cargo-dist release asset for the current platform/arch, verifies its sha256
  against the release's `.sha256` asset, and stages the binary at
  `resources/sidecar/intentd[.exe]`. A GitHub token with read access
  (`INTENTD_READ_PAT`, or `GH_TOKEN`/`GITHUB_TOKEN`) is only needed while the
  intentd repo is private. The script is idempotent; use `--force` to re-fetch.
- **Local dev builds**: `scripts/copy-sidecar.cjs` still stages a locally built
  binary from `packages/intentd/target/release` (`make build-sidecar` /
  `make dev` in the monorepo).

The platform/arch → release-asset mapping lives in
`scripts/fetch-sidecar-lib.mjs` (unit-tested in
`scripts/fetch-sidecar-lib.test.ts`); update it there if the intentd release
target list changes.

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

## Reporting issues

Bug reports and feature requests for all Intent components — including this
frontend — are tracked centrally on the
[intent-hq/monorepo issue tracker](https://github.com/intent-hq/monorepo/issues),
not on this repository.

## Network & privacy

The desktop app is local-first and ships **no telemetry or analytics** —
Segment, Sentry error reporting, and download-attribution have all been
removed. The app itself makes only these network calls:

- **Auto-updates** — the built app checks for and downloads updates from
  GitHub Releases on
  [intent-hq/cloudlands-releases](https://github.com/intent-hq/cloudlands-releases).
  `AUTO_UPDATE_URL` in `src/shared/constants.ts` is the release-download base
  URL; the `publish` URL in `electron-builder.yml` appends the release channel
  (e.g. `/stable`).
- **Auggie binary download (on demand)** — when you install the Auggie CLI from
  the app, the pre-built binary is downloaded from the latest public release of
  [augmentcode/auggie](https://github.com/augmentcode/auggie)
  (`AUGGIE_BINARY_BASE_URL` in `src/shared/constants/auggie.ts`).
- **Sentry integration (opt-in, user-configured)** — if you connect a Sentry
  account with your own API token, the app calls the Sentry REST API
  (`SENTRY_API_BASE_URL` in `src/features/sentry-auth/constants.ts`) to browse
  your organization's issues and projects. Nothing is sent to Sentry unless you
  configure this integration.

Everything else goes through the local `intentd` daemon. Daemon-side network
calls — provider OAuth sign-ins, user-configured integrations (GitHub, Linear,
Sentry), and the sitter self-update — are documented in the
[monorepo README's Network & privacy section](https://github.com/intent-hq/monorepo#network--privacy).

## History

This repository is the frontend **ported from the prior Electron app** and
wired to the `intentd` daemon through the AppClient JSON-RPC boundary. It
**replaces the earlier Tauri v2 prototype** that previously occupied this repo.

## License

Licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for
attribution and lineage details.

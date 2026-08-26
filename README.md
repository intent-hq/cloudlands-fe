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

# Fast browser-only component work
make dev-ui

# Full app with an intentd sidecar
make dev
```

`make dev-ui` installs the locked frontend dependencies when needed and opens no
Electron or daemon process. `make dev-ui DEV_PORT=5290` gives a concurrent workspace
its own strict Vite port. For the full stack, `make dev` builds `intentd` and launches
the app with it as a sidecar (see [intentd sidecar pin](#intentd-sidecar-pin)).

### Standalone

You can also clone and run this repository on its own (the app falls back to the
mock AppClient when no daemon is present):

```bash
git clone https://github.com/intent-hq/cloudlands-fe.git
cd cloudlands-fe
corepack pnpm install --frozen-lockfile
corepack pnpm run dev:ui
```

Use `corepack pnpm run dev` instead when you need the complete Electron app. Without a
staged `intentd` sidecar, it falls back to the mock AppClient.

## Commands

Use the repository-pinned `pnpm` through Corepack, not `npm`. The following scripts are
defined in `package.json`:

```bash
corepack pnpm install --frozen-lockfile # Install locked dependencies
corepack pnpm run dev:ui        # Fast named-state component preview
corepack pnpm run dev:web       # Complete plain-browser renderer
corepack pnpm run dev           # Complete Vite + Electron app
corepack pnpm run dev:cdp       # Electron app with CDP support
corepack pnpm run build         # Production build (renderer, main, preload)
corepack pnpm run build:web     # Build static plain-browser output in dist/web
corepack pnpm run check         # Svelte + TypeScript diagnostics
corepack pnpm run lint          # ESLint
corepack pnpm run format        # Prettier write pass
corepack pnpm run test:unit     # Vitest unit suite
corepack pnpm run test:playwright # Playwright tests
```

### Fast named-state previews

Use `dev:ui` for isolated component work, `dev:web` for the complete browser renderer
and its client connection, and `dev:cdp` for Electron main, preload, native, window, or
shell work. A direct preview URL controls state, theme, width, and motion:

```text
http://127.0.0.1:5190/sandbox/button?state=loading&theme=dark&width=420&motion=reduced
http://127.0.0.1:5190/sandbox/mention-agent-avatar?state=waiting&theme=dark&width=420&motion=reduced
```

Button provides `default`, `loading`, `disabled`, and `destructive`. Mention agent
avatar provides `idle`, `waiting`, and `error`. See the monorepo
[Developer Guide](../../docs/fe/DEVELOPER_GUIDE.md#fast-ui-preview-workflow) for every
working URL, browser discovery and readiness calls, HMR and hidden-tab guidance, and a
targeted component-test command.

### Web runtime configuration

`dev:web` accepts `VITE_INTENTD_WS_URL` as a local-development convenience.
`build:web` deliberately does not compile that value into static JavaScript,
because a full WebSocket URL can contain userinfo, query credentials, or a
fragment. Production hosting should replace `/runtime-config.js` at response or
deployment time and set `globalThis.__INTENT_RUNTIME_CONFIG__.intentdWsUrl` to a
`wss://` URL. Serve that asset over authenticated HTTPS with `Cache-Control:
no-store`, and use a short-lived, per-user credential rather than a shared
secret. The URL is necessarily visible to that browser session; this separation
prevents it from leaking through versioned bundles, source maps, and long-lived
CDN caches. The committed empty runtime config preserves the standalone mock
fallback when no live daemon is configured.

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

## Release channels

Desktop builds are distributed through three rolling releases (`alpha`, `beta`,
`stable`) on
[intent-hq/cloudlands-releases](https://github.com/intent-hq/cloudlands-releases),
each pointing the auto-updater at the latest build for that channel:

- **alpha** — every `vX.Y.Z` tag (cut by merging the release-please PR) builds
  the app and publishes both an immutable versioned release and the rolling
  `alpha` release (`.github/workflows/release-alpha.yml`).
- **beta** — a manual promotion of an existing versioned release (no new
  build): dispatch `.github/workflows/promote-beta.yml` with the `version`
  input to copy that release's assets and updater feeds into the rolling
  `beta` release.
- **stable** — same promotion model via `.github/workflows/release-stable.yml`;
  it additionally marks the promoted version as Latest.

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

Frontend documentation lives in the monorepo's [`docs/fe/`](../../docs/fe)
(the relative links resolve in a monorepo checkout, where this repo mounts at
`packages/cloudlands-fe/`). Key references:

- [STATE_MANAGEMENT.md](../../docs/fe/STATE_MANAGEMENT.md) — Redux + saga state policy
  and the Svelte-store migration.
- [MODULE_BOUNDARY_GUIDE.md](../../docs/fe/MODULE_BOUNDARY_GUIDE.md) — renderer↔main
  and feature boundaries.
- [TYPE_SYSTEM_GUIDE.md](../../docs/fe/TYPE_SYSTEM_GUIDE.md) — TypeScript and type
  safety conventions.
- [EVENT_SYSTEM.md](../../docs/fe/EVENT_SYSTEM.md) — the unified event system.

## Reporting issues

Bug reports and feature requests for all Intent components — including this
frontend — are tracked centrally on the
[intent-hq/monorepo issue tracker](https://github.com/intent-hq/monorepo/issues),
not on this repository.

## Network & privacy

The desktop app is local-first and ships **no telemetry or analytics**. The
only network calls the app itself makes go to public GitHub Releases:

- **Auto-updates & release notes** — the built app checks for and downloads
  updates from GitHub Releases on
  [intent-hq/cloudlands-releases](https://github.com/intent-hq/cloudlands-releases),
  and fetches release notes for the installed version from the same repo's
  GitHub Releases API
  (`src/features/release-notes/main/release-notes.service.ts`).
  `AUTO_UPDATE_URL` in `src/shared/constants.ts` is the release-download base
  URL; the `publish` URL in `electron-builder.yml` appends the release channel
  (e.g. `/stable`).

Everything else goes through the `intentd` daemon the app is connected to —
local by default; connecting to a remote daemon makes that daemon traffic go
to the host you chose. If you connect the GitHub, Linear, or Sentry
integrations, the daemon calls those services' APIs on your behalf — nothing
is sent to them unless you configure the integration — and the daemon is
likewise what probes an MCP server when you test its connection. Daemon-side
network calls — provider OAuth sign-ins, the user-configured integrations
(GitHub, Linear, Sentry), user-configured MCP servers, and the sitter
self-update — are documented in the
[monorepo README's Network & privacy section](https://github.com/intent-hq/monorepo#network--privacy).

## History

This repository is the frontend **ported from the prior Electron app** and
wired to the `intentd` daemon through the AppClient JSON-RPC boundary. It
**replaces the earlier Tauri v2 prototype** that previously occupied this repo.

## License

Licensed under the [Apache License 2.0](./LICENSE). See [NOTICE](./NOTICE) for
attribution and lineage details.

# Agents

Quick routing guide for AI agents. Start here, then open the smallest relevant doc.

**Assistant app guide:** a user-facing change updates the affected section of
[`packages/intentd/crates/intent-services/resources/assistant-app-guide.md`](../intentd/crates/intent-services/resources/assistant-app-guide.md)
in the same change, coordinating the companion intentd change (also from standalone
frontend checkouts; companion merges need not be simultaneous). Do not promote unfinished,
Labs-only or unreleased features as normal options. Before opening a PR, record the
affected guide section or explain why there is no user-help impact. Full rule:
[root `AGENTS.md`](https://github.com/intent-hq/intent/blob/main/AGENTS.md).

> **Merge permission**: never merge a PR or arm auto-merge without explicit permission
> from a human — approved + green is not enough. See the monorepo root
> [`AGENTS.md`](https://github.com/intent-hq/intent/blob/main/AGENTS.md#conventions) for the full rule.

## Tech stack

- Electron + SvelteKit + TypeScript desktop app
- Svelte 5 runes for UI rendering only; ALL shared/domain state MUST use Redux + sagas
- Svelte stores (`*.store.svelte.ts`) are **DEPRECATED** — every one is a migration
  target. Do not create, expand or entrench them (including new reads of an existing one);
  ephemeral component-local UI state is fine without Redux. Move toward removal with the
  [Migration Guide](src/store/renderer/docs/MIGRATION_GUIDE.md) and
  [`STATE_MANAGEMENT.md`](../../docs/fe/STATE_MANAGEMENT.md).
- Use `pnpm`, not `npm`; create agents via `agentFactory.createAgent()`.

## UI rules

- Start with the [“I need to…” decision tree](docs/DESIGN_SYSTEM.md#i-need-to), not raw markup.
- Use the generated [pattern cheatsheet](docs/DESIGN_SYSTEM_CHEATSHEET.md) for imports and API summaries.
- Inspect live fixtures and copyable compositions at `/sandbox` and `/sandbox/recipes` via `pnpm run dev:ui`.
- Use public `$lib/components/patterns/*` or `$lib/components/ui/*` subpaths; do not deep-import implementations.
- Follow the [Never list](docs/DESIGN_SYSTEM.md#never), enforced by `eslint-rules/design-system/`.
- Never hand-write motion durations or physical colors; use `$lib/motion` and semantic tokens.
- Never pause, stop, or disable animations app-wide on your own (window blur, battery, visibility,
  performance). Gate it behind an existing setting — OS reduced motion and "Reduce motion on
  battery" via `prefersReducedMotion()` / `data-reduce-motion`, or "Pause animations when not in
  focus" via `data-window-blurred` — or add a new Appearance setting that defaults to off.
- Never add a raw control, direct toast/native dialog, bespoke settings row, or feature-owned dialog root.
- Ratchets only shrink: do not raise `scripts/ui-component-guardrails.ts` ceilings or expand lint baselines.
- Run `pnpm run lint:design-cheatsheet` (part of `pnpm run lint`) with the focused lint/tests; regenerate the cheatsheet with `pnpm exec tsx scripts/generate-design-cheatsheet.ts`.

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

| Working on…                                                             | Open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agents                                                                  | ../../docs/fe/agent-message-dedup-and-stream-sagas.md, ../../docs/fe/RULES_SYSTEM.md                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `agent.list` requests (unbounded on a large workspace)                  | `pnpm run lint:agent-list-scope` — `scripts/check-agent-list-scope.mjs` fails any non-test `agent.list` request (wire literal, `agents.list` / `listWithMeta`, saga `call` / tuple) without `retiredOnly: true` or a `scope` literal / variable (`false`, `undefined`, `''` and words inside strings do not bound it); the file-level `ALLOWLIST` in the script needs a one-line reason and stale entries fail; CI runs it via `lint:architecture` (intent-hq/intent#5531)                                   |
| state/store                                                             | ../../docs/fe/STATE_MANAGEMENT.md, src/store/renderer/docs/                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| component design                                                        | ../../docs/fe/COMPONENTS_DESIGN.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| UI invariant gates                                                      | `pnpm run test:ui-invariants` — ratchets + catalog `*.meta.ts` ledgers, see below                                                                                                                                                                                                                                                                                                                                                                                                                            |
| adding a ratcheted lint rule                                            | `eslint-rules/lib/baseline-ratchet.js` — `lintRuleFromRepoConfig` derives scope from `eslint.config.js` (same rule entries and global ignores as `pnpm lint`); the baseline is one entry file per tolerated source file, `eslint-rules/baselines/<rule>/<source path>.json` (`loadBaseline`), so parallel debt-reduction PRs delete disjoint files instead of conflicting on one document; per-file counts only shrink vs `LINT_BASELINE_BASE_REF` (CI sets it to the PR / queue base; falls back to `HEAD`) |
| deps freshness                                                          | `pnpm run deps:check` — gates refuse to run on a stale node_modules install                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Node version                                                            | `pnpm install` and gates refuse to run on a Node outside `engines.node` (the one range)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| panels/layout                                                           | ../../docs/fe/panel-system-refactoring.md, ../../docs/fe/PANEL_TAB_UX_SPEC.md                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PR descriptions                                                         | ../../docs/fe/PR_DESCRIPTION_GUIDE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| browser/CDP                                                             | ../../docs/fe/BROWSER_PANEL_SPEC.md, ../../docs/fe/CDP_MCP_TOOLS.md                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| browser tab contract (`ws.browser.*` actions, `errorCode`, `displayed`) | `src/features/browser/main/browser-action-executor.ts`, `embedded-browser-cdp-service.ts`, the browser-tab-registry saga, `src/shared/types/browser-clients.ts` (`BrowserTabInput` / `BrowserTab` own the `displayed` wire field) — change together with intentd `crates/intent-acp/src/mcp_server/bindings/browser_docs/*.md` (the `ws.browser.docs` text) and `../../docs/protocol/methods/files-terminal-browser.md`; monorepo `make docs-check` cross-checks the shared tokens                           |
| module boundaries                                                       | ../../docs/fe/MODULE_BOUNDARY_GUIDE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| motion perf traces                                                      | `pnpm perf:chat-motion` — ../../docs/fe/DEVELOPER_GUIDE.md#chat-motion-performance-traces                                                                                                                                                                                                                                                                                                                                                                                                                    |
| alignment / text-rebase perf claims                                     | `pnpm perf:text-rebase --base <ref>` — paired head/base runs of `src/lib/notes/text-rebase-bench.runner.ts` in fresh processes, interleaved with the pair order alternating per run so drift hits both sides (`--head <ref>`, `--runs`, `--repeats`, `--shapes`, `--json`); cite its table in the PR. Bare packages resolve from the current `node_modules` for both trees; the header labels each tree's mapper mode and warns when a pre-#2740 base (`legacy-two-mapper`) is not comparable like-for-like  |
| debugging                                                               | ../../docs/fe/TROUBLESHOOTING_GUIDE.md, ../../docs/fe/IPC_DEBUG_GUIDE.md                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| prod stack traces                                                       | `pnpm resolve-stack <tag> < stack.txt` — rebuilds the tag with sourcemaps, maps frames                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CT run failures (PR or nightly triage)                                  | `pnpm ct:failures <run-id \| run-url>` — every failed/flaky CT case of an `Intent PR Checks` or `Nightly Browser Tests` run, per shard, from the shard's JSON report artifact (list-log summary fallback); `--attempt N`, `--json`                                                                                                                                                                                                                                                                           |
| full local CT run (all shards)                                          | `pnpm run test:ct:full` — the four CT shards in sequence via `test:ct` (CI's `@quarantine` filter, one `ct-<CT_PORT>` lock); per-shard log, JSON, HTML and traces in `ct-full-runs/<stamp>/shard-<i>/`, then one line per shard, failed/flaky cases, a total and `summary.json`; every shard runs, exit 0 only if all pass. About 2h15m (shards 25-40 min): give a monitor a 3h+ TTL. `-- --list` checks wiring                                                                                              |
| error handling                                                          | ../../docs/fe/ERROR_HANDLING_SYSTEM.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| TypeScript/types                                                        | ../../docs/fe/TYPE_SYSTEM_GUIDE.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| events/IPC                                                              | ../../docs/fe/EVENT_SYSTEM.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| keybindings                                                             | ../../docs/fe/KEYBINDINGS.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| deploying/releasing                                                     | ../../docs/fe/DEPLOYING.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Key conventions

- Put renderer product work in `src/features/`; shared utilities live in `src/lib/`.
- Keep shared app state in `src/store/renderer/`, not ad-hoc component state.
- **Selector readables belong at component init only** — `selector()` uses Svelte context and must not run in event handlers or callbacks. Dispatch actions and perform one-time selector reads through the configured app `Store` instance, e.g. `store.dispatch(action)` and `selector.select(store.state, ...args)`. See `../../docs/fe/STATE_MANAGEMENT.md` for details.
- **Never import from a feature's **`main/`** subtree in renderer code** (or vice-versa).
- **Don't export utility functions from orchestration modules** — extract to a dedicated `utils/` file.
- **Keep utilities dependency-light** — no stores, services, or side effects.
- **Never quote the literal breaking-change footer token** — release-please treats
  `BREAKING CHANGE:` / `BREAKING-CHANGE:` (and `Release-As:`) anywhere in a commit body,
  including any branch commit folded into the squash body, as a real footer (this cut a
  false v3.0.0, intent-hq/intent#2988). Never write the literal token in commit messages, PR
  titles/bodies, or review comments unless a breaking change is intended; write "the
  breaking-change footer token" instead ([root `AGENTS.md`](https://github.com/intent-hq/intent/blob/main/AGENTS.md#conventions)).

## Internationalization (i18n)

All user-facing strings (labels, aria-labels, placeholders, tooltips, toasts, errors, menu items) go through Paraglide message functions — never hardcode them.

- **Messages**: call `m.*()` (import from `src/shared/paraglide/messages.js`); keys live in `messages/en.json`. Key naming: `{feature}_{component}_{purpose}`, camelCase segments, role suffixes `_label` / `_description` / `_placeholder` / `_ariaLabel` / `_tooltip` / `_error` (e.g. `settings_wsApi_port_invalid`).
- The compiled output (`src/shared/paraglide/`) is **gitignored** — `verify:changed`, `test:unit`, `lint:dead-code`, and `test:ct` regenerate it on demand when it is missing or stale; run `pnpm run generate:i18n` to rebuild it by hand after editing `messages/en.json`.
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
corepack pnpm run lint          # ESLint + i18n string/completeness + package-script pnpm nesting + knip dead code + Prettier check
corepack pnpm run format        # Prettier write pass
corepack pnpm run format:check  # Prettier check (also runs inside `lint`)
corepack pnpm run test:unit     # Vitest suite
corepack pnpm run test:playwright
```

`.git-blame-ignore-revs` lists the repo-wide Prettier reformat commit so `git blame` skips it (GitHub honors it automatically; opt in locally with `git config blame.ignoreRevsFile .git-blame-ignore-revs`).

A test that budgets wall time (perf guards, alignment work bounds) must fit its timeout
under CI runner load, not just in isolation — the local 30 s `testTimeout` by default
(`vitest.config.ts` raises it to 60 s on CI, from `scripts/vitest-timeouts.mjs`) or the documented per-test budget; catalog contract entries derive theirs from their snapshot size (`src/lib/component-catalog/catalog-contract-budget.ts`).
`intent/no-wall-clock-assertions-in-tests` (in `pnpm run lint`) flags a raw
`performance.now()` / `Date.now()` elapsed-time assertion against a millisecond budget and
names the alternatives; today's offenders are baselined under
`eslint-rules/baselines/no-wall-clock-assertions-in-tests/`, and counts only shrink. Before
pushing such a test, run `pnpm test:loaded <file or filter> [-- <extra vitest args>]`: one
worker pinned to a single core (`taskset`, Linux only; unpinned on macOS) shared with three
busy loops, exiting with vitest's code. `LOADED_CORE=<n>` / `LOADED_BUSY=<n>` override the
core and loop count; `CI` is inherited from your shell, so the run uses the local 30 s
timeout unless you export `CI` yourself.

## Fast UI preview loop

Use `dev:ui` for component-only work. It skips Electron, native helpers, the daemon,
and production application sagas. Use `dev:web` when the full browser renderer or a
client connection is required. Use `dev:cdp` for Electron main, preload, native,
window, or shell behavior.

For remote-host lifecycle, browser, evidence, and hand-off steps, follow the monorepo
root [`Developing on a remote host`](../../AGENTS.md#developing-on-a-remote-host) loop.
Choose `make dev-sandbox-ui` for this recipe. UI mode intentionally has no daemon bridge
or `/__sandbox/health`; wait for its component-ready marker instead.

Use these exact state names in direct URLs:

- `/sandbox/button?state=default`, `loading`, `disabled`, or `destructive`
- `/sandbox/mention-agent-avatar?state=idle`, `waiting`, or `error`
- Add `theme=system|light|dark`, an integer `width=240..1600`, and
  `motion=full|reduced`. Example:
  `/sandbox/button?state=loading&theme=dark&width=420&motion=reduced`.

On the sandbox page, use `window.__INTENT_PREVIEW__.list()` to find preview IDs,
`await window.__INTENT_PREVIEW__.states('button')` to find states, and
`window.__INTENT_PREVIEW__.current()` to inspect the active ready state. Wait for
`[data-preview-ready=true]` before capture. For a cold renderer launch, use the
[self-checking readiness hook](.agents/skills/electron/SKILL.md#wait-for-renderer-readiness)
instead of polling or rescheduling an expired hook.

### Visual verification

For a component change that has a sandbox scene, capture and inspect a screenshot.
Use before/after geometry probes when they help explain a layout change, and include
the useful evidence in the task report:

```bash
pnpm sandbox:probe workspace-hover-card --state landscape-wide
pnpm sandbox:shot workspace-hover-card --state landscape-wide
```

Both commands require the scene as the first argument and `--state <name>`. They start
an in-process Vite server with `INTENT_UI_PREVIEW=1` and `INTENT_BUILD_TARGET=web`, use
`fit=component`, and wait for both the ready and stable markers. To reuse a running
`dev:ui` server, pass its root URL with `--base-url http://127.0.0.1:<DEV_PORT>`.
Shared options (`--theme`, `--width`, `--motion`, `--scale`, `--timeout`, `--out`,
`--allow-console-errors`), font stability and the per-harness optimizer cache are in
[Sandbox probe and shot options](../../docs/fe/DEVELOPER_GUIDE.md#sandbox-probe-and-shot-options).

`sandbox:shot` captures the complete component frame without shell chrome or scrolling.
By default it writes
`.demo-artifacts/sandbox/<scene>--<state>--<theme>--<width>.png` and prints its path,
pixel dimensions, and URL. `sandbox:probe` prints stable JSON to stdout; pass
`--selector <css>` to measure custom descendants or `--out
.demo-artifacts/sandbox/<name>.json` to save it. `.demo-artifacts/sandbox/` is
git-ignored; never commit these visual-review artifacts.

Probe output is manual review evidence, not a checked-in pixel baseline or an automated
pass/fail contract. Register sandbox scenes for visual review without blanket coordinate
or size snapshot tests. Add browser assertions only for the user-visible contracts in
[Testing](#do-not-write-decorative-appearance-tests). See
`../../docs/fe/DEVELOPER_GUIDE.md#fast-ui-preview-workflow` for the manual preview loop.

### Put a preview screenshot in user chat

Follow the root Observe and Prove steps with a fixed viewport. For this preview, require
`[data-preview-ready=true]` and confirm `window.__INTENT_PREVIEW__.current()` has the
expected state and `status: 'ready'` before capture. Keep the returned image block in the
user response; a local path alone does not display an image in chat.

Prefer `sandbox:shot`, verify the resulting PNG, save it with `ws.note.saveAsset`, and
embed the returned workspace asset URL in chat or a note.

If the command cannot reach the preview, use an owned hidden embedded-browser tab as
the fallback. Call `ws.browser.listTabs` first and reuse a matching tab; otherwise call
`ws.browser.openTab` with the preview URL under
`http://daemon.localhost:<DEV_PORT>/`. Wait no more than 15 seconds for
`[data-preview-ready=true]`. Confirm that
`window.__INTENT_PREVIEW__.current()` has the expected state and `status: 'ready'`, then
call the browser `screenshot` action and keep its image block in the user response.

`playwright-cli` is typically absent on remote hosts; use it only as a local fallback if
the browser screenshot call reaches its 30-second limit. Do not retry the same stalled
browser call. In a new,
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

For focused browser validation, run:

```bash
corepack pnpm run test:ct -- src/features/agent/components/agent-avatar/__tests__/agent-avatar-waiting.ct.spec.ts
```

The CT harness defaults to port 3100 (the `CT_PORT` env var overrides it). A run holds
the host-wide `ct-<CT_PORT>` lock, so a second run on an occupied port waits for the
first instead of reusing its server; set a free `CT_PORT` to run concurrently (see
[Verification](#verification)). The port also keys the generated bundle cache
(`playwright/.cache-<CT_PORT>`; bare `playwright/.cache` when unset), so per-port runs are
isolated for server, lock, and cache — including within one worktree. The run exits with Playwright's
status as soon as the tests finish — the HTML report is written to `playwright-report/`
but never served automatically. To browse it after the run, opt in from an interactive
terminal with `CT_HTML_REPORT=open` (or `-- --open-report`); `node
scripts/run-ct-tests.mjs --help` lists the options. The full workflow is in
`../../docs/fe/DEVELOPER_GUIDE.md#fast-ui-preview-workflow`.

## Dogfooding a dev FE against a daemon

Start with the monorepo root
[`Developing on a remote host`](../../AGENTS.md#developing-on-a-remote-host) loop. It owns
the canonical status, sandbox lifecycle, health wait, browser, evidence, and hand-off
steps. The deeper implementation contract is in the
[`Remote Sandbox Internals`](../../docs/fe/DEVELOPER_GUIDE.md#remote-sandbox-internals).

### Loop A — web build in an embedded tab (primary; renderer/UI work)

The app and stack sandboxes enable the Vite dev server's same-origin daemon bridge. The
renderer reaches `/intentd/ws` on the page origin through `INTENTD_SOCKET` or the platform
default socket; `/__sandbox/health` checks the same socket plus Vite warm-up. The browser
therefore needs one tunnel for the page, daemon RPC, and HMR.
During the first page load, the health probe returns 503 quickly while warm-up is pending
rather than blocking on the import crawl.

A first tunneled open of a fresh, pre-warmed app takes roughly one to three minutes to
hydrate depending on host load. If the splash remains after health is ok, keep waiting
rather than restarting; later loads are fast.

To land on a chosen chat or note, open `/workspace/<workspaceId>?agent=<agentId>` or
`?note=<noteId>` (both may be combined). Do not use `/agent/<id>`: on a cold load it shows
an empty placeholder, not the workspace chat panel. Recipe:
[`Open a chat or note in the app sandbox`](../../docs/fe/DEVELOPER_GUIDE.md#open-a-chat-or-note-in-the-app-sandbox).

The bridged daemon API is unauthenticated. Keep Vite on loopback and reach it only through
the Intent client's authenticated tunnel.

Tunneled Chromium treats `daemon.localhost` as a remote origin. Consequently,
`workspace-file://` media do not load in that embedded tab even though they load in
Electron; validate such media in an Electron build.

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
notarization, Windows Azure Artifact Signing). A signed Windows request first runs the
`windows-signing-preflight` job, which fails in seconds — naming every missing
`INTENT_WINDOWS_AZURE_*` / `INTENT_WINDOWS_PUBLISHER_*` / `AZURE_*` setting — when the
repository's Azure signing is not configured; re-run with `-f sign=false` for an unsigned
Windows build. Add `-f intentd_ref=<hash>` (any intent-hq/intentd git
ref — full 40-char commit SHA, branch, or tag; `actions/checkout` cannot resolve an
abbreviated SHA from `git log --oneline`) to build the intentd sidecar from source at
that ref instead of fetching the pinned release (all legs: macOS, Windows, and both
Linux arches); the run summary reports the resolved intentd SHA. Empty/omitted
`intentd_ref` keeps today's pinned-release fetch.
Output is installers + blockmaps only, uploaded as
short-lived workflow artifacts (7-day retention), version-suffixed `-manual.<run_number>`.
Nothing publishes to intent-hq/cloudlands-releases and no auto-updater manifest is
produced — manual install/testing only.

## Update compatibility

Released clients are part of the compatibility contract. Changes to update feed
filenames or URLs, channel metadata, installers, or architecture support must preserve
an automatic upgrade path for existing supported installations within each channel.
A migration must not require users to install the migration code manually first.

Test behavior shipped in a prior release, including its requested feed filenames and
architecture selection. New-client tests and successful builds/uploads are insufficient.
Keep these regression tests in required verification. For Mac feeds, extend
`scripts/mac-channel-feeds.test.ts`: `latest-mac.yml`, used by released beta/stable
clients, must advertise the selected release for each channel independently.

If a compatibility break is unavoidable, identify the exact affected installations and
obtain explicit human authorization for that break. Documenting a workaround is not
authorization; ending Intel support does not authorize stranding native Apple Silicon.

## Verification

Use `pnpm run verify:changed -- <paths...>` during local work. With no paths it reads
staged, unstaged, deleted, and untracked frontend files, plus the commits since
`git merge-base <ref> HEAD` when `--base <ref>` is given. When that working-tree set is
empty and `HEAD` is ahead of `origin/main`, it defaults to `--base origin/main`, so the bare
command is correct on a committed PR branch; a change set empty either way exits 2.
`--dry-run` lists the commands. `--resolved-plan` runs prerequisites and Vitest discovery
only, printing every selected unit-test file per lane; normal runs resolve the same plan
first, and discovery failures stop before any check (fix the reported config or source
error and retry). `--max-unit-files N` rejects (never truncates) a plan over N files —
combine it with `--resolved-plan` for a budgeted preview, then raise or omit the limit.
`pnpm run test:unit --maxWorkers=1` runs the full unit suite.

Each run prints `record: <path>` for its attempt under `.dev/verify-changed/attempts/`
and passes only when every check and resolved unit file is satisfied. To continue after a
failure or interruption, rerun with `--resume` (`--resolved-plan --resume` previews it);
never hand-pick stages. Receipt files and resume-credit rules:
[Changed-file verification receipts](../../docs/fe/DEVELOPER_GUIDE.md#changed-file-verification-receipts).

It runs scoped Prettier and ESLint, related Vitest tests, colocated component tests one
`.svelte` hop away, the changed TypeScript boundaries, knip repo-wide, `test:ui-invariants`
for renderer changes, and `lint:architecture` for `src/`, `AGENTS.md` and
`scripts/check-*.mjs` changes; ambiguous or high-risk files select a conservative suite.
Lane selection in detail: [What verify:changed selects](../../docs/fe/DEVELOPER_GUIDE.md#what-verifychanged-selects).
Rules that follow from it:

- A suite that reads the tree from disk is invisible to `vitest related`: declare
  `// @verify-changed-triggers: <paths or globs>` in its leading comments or opt out with
  `// @verify-changed-exempt: <reason>` (`lint:verify-changed-triggers`; cloudlands-fe#2256, #2314).
- Mark any new component-inventory or `*.meta` ledger suite `// @ui-invariant` (or
  `// @ui-invariant-exempt: <reason>`); `node scripts/ui-invariant-suites.mjs --list` / `--check`.
- New architecture gates go into `lint:architecture` in `package.json`, never a separate
  workflow step (`scripts/check-ci-architecture-gate.test.ts`).
- Do not write protocol version numbers in `src/` (`v10.1`, or `10.1` on a line mentioning
  protocol/intentd/daemon); cite the method, field, `§` section or capability.
  `lint:protocol-version-literals` accepts `// protocol-version-ok: <reason>` on the line or
  `// protocol-version-ok-file: <reason>` in a file's first 10 lines.
- Never hand-edit `src/preload/index.ts`; `pnpm run generate:ipc-channels` generates it.
- Workflow edits: `pnpm run lint:workflows` (part of `lint:architecture`) runs the pinned
  actionlint with shellcheck; add path-scoped ignores with a reason there.

Playwright CT holds a host-wide `ct-<CT_PORT>` lock (default `ct-3100`) and the full Vitest
fallback holds `vitest-full`. A second run waits (240 s / 120 s by default,
`VERIFY_CHANGED_LOCK_TIMEOUT_MS` up to 300000 ms) and then fails naming the owner's pid and
worktree; never stop a lock owner — pick a free `CT_PORT` to run CT concurrently
(intent-hq/intent#4964).

After any structural change (moving files, changing imports, extracting modules):

```bash
pnpm vitest run <targeted-test-files>
pnpm run check                              # Svelte + TypeScript consumers
pnpm tsc -p tsconfig.json --noEmit          # renderer
pnpm tsc -p tsconfig.main.json --noEmit     # main process
pnpm run generate:ipc-channels && pnpm tsc -p tsconfig.preload.json --noEmit  # preload
```

`pnpm run check` must run alongside plain `tsc` because Svelte component consumers are not fully type-checked by `tsc` alone. All three typechecks must pass. The main typecheck requires `pnpm run generate:build-config` to have been run at least once; the preload typecheck requires `pnpm run generate:ipc-channels` first, since the untracked `src/preload/index.ts` is the preload `tsconfig`'s only input and is absent after a fresh install.

## Frontend philosophy & testing

The renderer is a **thin presenter** over the daemon. Correctness, business rules, and
persistence live in `intentd`; the FE renders what the daemon sends and dispatches user
intent back. The wire contract is the monorepo's
[`docs/protocol/`](../../docs/protocol/README.md) (the relative link resolves in a
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
  `docs/protocol/`: the BE is the preferred fix-site (it owns the
  contract), or the protocol doc is updated when the documented shape itself is wrong. The FE
  is never bent to silently absorb a divergence.
- Recent example: `tool_use` and `tool_result` blocks must pair by
  `toolCallId ↔ tool_use_id` per protocol §7 (`chat.subscribe` synthesized blocks).
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
[intent-hq/intent#1395](https://github.com/intent-hq/intent/issues/1395), the
active-streams fan-out). Prefer a targeted query for the affected workspace, or a
daemon-side aggregate that returns everything in one RPC — if none exists, request one
on the BE rather than looping on the client.

### Saga-owned mutations & soft-hide-then-commit

Agent lifecycle mutations are owned by `agentMutationSaga` in
`src/store/renderer/slices/agent-session/sagas/agent-mutation-saga.ts`, registered once
in `src/store/renderer/sagas.ts`. Creation is owned by `agentCreationSaga` and routes
through `agentFactory.createAgent()`. Extend these owners, not a mutation middleware
or a second runtime. Existing async-action callers (`*Requested` actions with a
`.promise`) remain supported: settle through the originating action's
`action.success`/`action.failure` helpers so each dispatch retains its correlation.
New UI consumers dispatch intent and read correlated selector outcomes; the saga
owns transport calls, rollback and notifications.

Agent **deletion** uses the **daemon-owned delete grace window** (protocol §5.5,
`agent.delete { undoDelayMs }`; the handlers live in the agent mutation saga):

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

#### Pixel comparison tests are forbidden

**Never add, restore, run, or regenerate pixel comparison tests. There are no
exceptions for a component, feature, platform, theme, zoom level, or CI runner.**
This ban covers screenshot/image snapshots, golden images, rendered pixel or alpha
sampling, image similarity scores, and byte/hash comparisons of rendered images.
Do not hide these checks in helpers, custom matchers, canvas redraws, or renamed
"visual" tests. Do not add reference images, comparison tolerances, baseline update
commands, or image-diff dependencies. Remove an existing violation; never refresh
its baseline or loosen its threshold to make it pass.

Enforce these bans during review. Do not add source-scanning scripts or fixture tests
to enforce the pixel comparison or DOM measurement baseline policies.

Manual screenshots and probes remain required for visual review where applicable.
They are review evidence only: never compare their pixels or use them as automated
pass/fail baselines. Test observable behavior with independent assertions instead.

#### Do not write decorative appearance tests

These rules apply to unit tests and browser tests alike:

- **Do not pin decorative choices:** exact colors, font families/sizes/weights, spacing,
  border widths/radii, shadows, or icon alignment. A browser measurement does not make
  a decorative assertion a behavioral contract.
- **Do not use source text, markup order, or CSS-class strings to prove appearance.**
  Those checks constrain implementation spelling without establishing browser behavior.
  `intent/no-class-name-assertions-in-tests` rejects new `className` / `classList` /
  `toHaveClass` assertions in `src/**/*.test.ts`; existing ones are counted in
  `eslint-rules/baselines/no-class-name-assertions-in-tests/`, which may only shrink.
- **Do not claim layout coverage from jsdom dimensions.** jsdom does not perform layout;
  assigning a width or mocking a bounding box and checking it cannot prove containment.
- **Do not build circular style oracles:** importing a production class constant and
  checking for those same classes, or copying production spacing into a fixture and
  measuring that fixture, does not independently verify the app.
- **Delete an appearance-only test when its useful assertions are gone.** Do not keep
  it alive with prop echoes, unconditional render checks, direct focus assignment checks,
  or expectations derived from its own mock. Every retained test needs an independent
  behavioral failure it can detect.
- **Do not multiply themes, widths, or zoom levels without a named behavioral reason
  for each variation.** Use the smallest set that exercises distinct contracts.

Keep real-browser checks for clipping or overlap that hides content or controls, scroll
ownership/anchoring, focus and keyboard access, usable hit areas, accessibility contrast,
and reduced-motion behavior. Name the user-visible failure the assertion prevents.
DOM geometry and computed styles are valid evidence for those contracts. This permits
measurements of live elements, never pixel sampling or comparison of rendered images.

| Do not write                                                                   | Write or retain instead                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Assert `rounded-lg`, an 8px radius, or an exact shadow.                        | Exercise opening, dismissal, and focus restoration of the actual dialog.                        |
| Assert an icon is centered within 1px or text uses a particular font size.     | Verify long or zoomed content leaves the control readable and operable.                         |
| Assert a warning equals an imported color token.                               | Check the warning appears for the relevant state and meets accessibility contrast requirements. |
| Read a Svelte file and expect padding classes or their source order.           | Exercise the production component in a browser and check content is not clipped or obscured.    |
| Set a jsdom container width and compare its `scrollWidth` to `clientWidth`.    | Mount the real component at a meaningful narrow viewport and check overflow and interaction.    |
| Import a style constant and assert every token occurs in the rendered classes. | Dispatch an action or change a prop and assert the resulting state, content, or interaction.    |
| Repeat an appearance assertion across every theme × width × zoom combination.  | Select named cases such as narrow keyboard access or zoomed control containment.                |

#### DOM measurement baselines are forbidden

**Never measure DOM elements and compare their size, position, or spacing with
hard-coded or generated appearance baselines. No exceptions.** This includes a single
width or height, inline numeric expectations, arrays or JSON of bounding boxes, saved
coordinates, snapshots, and expected values imported or generated from CSS, tokens,
fixtures, or a previous run. A tolerance, range, rounded value, ratio, renamed helper,
or claim of "geometry coverage" does not make an appearance baseline acceptable.
Remove violations; never record new measurements or adjust expected values to pass.

Do not recreate these tests under another name, add exemptions, or regenerate their
baselines. Capturing all boxes or path coordinates during a test and requiring the same
layout later is also a generated appearance baseline. Review must reject equivalent
custom comparisons.

Keep independent behavioral assertions: content stays within its live container,
controls remain reachable, a resize responds to user input, and scrolling preserves
the user's position. Accessibility minimum target sizes are standards-based bounds,
not decorative baselines. Small rounding tolerances may support these relationships;
they must not pin an ornamental dimension or spacing value. Pure layout algorithm
input/output contracts are also valid. Manual probes and screenshots remain review
evidence only; never turn their measurements into automated pass/fail baselines.

### Component tests (Playwright CT) — when and how

`scripts/ct-browser.mjs` owns the CT browser pin (the exact Chromium supplied by the
`ct-browser` alias); install it with `node scripts/run-ct-tests.mjs --install-browsers
chromium` and use the same `PLAYWRIGHT_BROWSERS_PATH` for install and tests. Traces use
`retain-on-first-failure`. Pin, patch and diagnostic configs:
[Component test browser pin](../../docs/fe/DEVELOPER_GUIDE.md#component-test-browser-pin).

Playwright CT (`*.ct.spec.ts`, run by `pnpm run test:ct`) is for behavior that only a
real browser can observe: functional layout/geometry, focus and keyboard handling, native
browser APIs, and motion behavior under the rules above. State, wire, validation, and
routing logic belong in Vitest — a CT spec
is roughly 10× the cost of a jsdom test and the CT job is sharded and time-boxed on CI.

- **Matrix cells must map to a named contract.** Loop over a width only when that width
  is a real breakpoint under test, over both themes only when color/theme is under test,
  over both zooms only when scaling is under test. A cross-product "for completeness" is
  not a contract and multiplies CI time.
- **One `test()` is one retry unit.** A loop of assertions inside a single `test()`
  callback, or a file under `test.describe.configure({ mode: 'serial' })`, is retried and
  reported as a block — one bad cell reruns the whole block and hides which cell broke.
  Generate one `test()` per cell instead, and do not use serial mode unless tests truly
  share ordered state.
- **A pass-on-retry fails the required CT lane** (`--fail-on-flaky-tests`). Fix the flake
  or tag the individual test `{ tag: '@quarantine' }` — never a whole file — with an open
  tracking issue and an owner. Quarantined tests still run as an advisory step on shard 1;
  the PR that fixes the flake removes the tag.
- **Browser suites never run on PR updates** (PRs run type/lint, unit tests and static
  checks). Merge-queue entries touching CT-contract paths, specs or their direct local
  imports (`scripts/ct-contract-paths.mjs`, shared with `verify:changed`) run the four CT
  shards; root Playwright and Electron lifetime test/harness/config changes run their
  suites. Everything also runs nightly at 02:17 UTC (`nightly-browser-tests.yml`) and on
  manual dispatch, so application changes can reveal browser regressions in the queue or
  after merge. Run the four shards locally with `pnpm run test:ct:full` (about 2h15m; see
  [Where to look](#where-to-look)); `pnpm ct:failures <run-id>` lists failed/flaky cases.
  `nightly-browser-report.yml` files or updates `intent-hq/intent` issues for nightly
  failures ([Nightly browser-test reporting](../../docs/fe/DEVELOPER_GUIDE.md#nightly-browser-test-reporting)).
- Motion specs that sample animation progress mid-flight are the historical flake source;
  assert start/end states, and check "no animation is running" with the
  `src/test/ct-test.ts` helpers, never a one-time `getAnimations()` count: a child's
  short fade caught mid-flight ejected cloudlands-fe#3651 from the merge queue.
  `expectAnimationsToSettle(locator)` waits for motion to finish (`includeFinished` also
  requires `fill: 'forwards'` leftovers to be removed). `expectNoAnimations(locator, opts)`
  asserts nothing animates; `opts.ignore` names a component (`{ within: selector }`)
  whose own short finite fades are allowed. Both list what is still running. Lint
  (`intent/no-one-shot-animation-count`) rejects the one-time count in CT specs; disable
  it on the line, with the reason, only when zero animations is the deliberate contract.
- Before an outside click that should dismiss a bits-ui menu, popover, select, combobox or
  dialog, call `expectDismissibleLayerArmed(layer)` (`src/test/dismissible-layer.ts`):
  bits-ui listens for outside pointers only after an `afterSleep(1)` timer, so an early
  click is ignored (cloudlands-fe#3696 failed 3 of 20 runs). Any element inside the layer
  works as `layer`. Lint
  (`intent/no-unarmed-outside-click-in-ct`) flags an unguarded dismissing click; disable it
  on the line, with the reason, for a click inside the layer or on a non-bits-ui popup.
  Prove a wait with `CT_DELAY_DISMISSIBLE_LAYER=1` (1 ms timers become 500 ms, no rebuild):
  the spec must pass, then fail with the wait removed (cloudlands-fe#3718 patched the fixture).
- Scroll with `wheelUntilScrolled(scroller, { deltaY })` (`src/test/ct-test.ts`), never a
  single `page.mouse.wheel`: Chromium can drop a wheel routed by a stale compositor frame,
  so the element never scrolls (cloudlands-fe#3733 failed 4 of 320 runs). The helper checks
  the element has room to scroll, hovers it (or `pointer`), and resends until it moves in
  the wheel's direction; keep your own end-position assertion after it. Lint
  (`intent/no-raw-mouse-wheel-in-ct`) rejects the raw call; disable it on the line, with
  the reason, only when the test checks that a wheel does NOT scroll.
- **Every CT spec imports `test` / `expect` from `src/test/ct-test.ts`** — lint-enforced
  (`no-restricted-imports`; only type imports may come from
  `@playwright/experimental-ct-svelte`). The module gives every test a fresh browser
  context, because ct-core's per-worker context reuse raced the next `mount()` (a
  pass-on-retry "Execution context was destroyed" at `mount(`). `CT_CONTEXT_REUSE=1` is
  for local wall-time measurement only, never CI. If the auto _Guard_ fixture fails with
  `browser context <id> was already used …`, fix the module, not the spec. A
  destroyed-context failure with the guard passing is a residual incident to investigate,
  never to quarantine or retry away; the _Recorder_ attaches `cdp-lifecycle.json` to the
  HTML report for it. How to read
  both: [Component test fresh-context guard](../../docs/fe/DEVELOPER_GUIDE.md#component-test-fresh-context-guard).

### Testing — every feature/fix against a mock BE

Every feature and every bug fix that touches the wire **MUST** ship with tests that:

1. **Assert the exact request sent on the wire** — channel/method plus the params payload
   — matching the request shape `docs/protocol/` defines for that method.
2. **Feed a protocol-shaped mock response** back through the same channel and assert
   the FE handles it (state updates, rendered output, downstream events).

Responses that diverge from the protocol docs are fixed at the **BE** (or the doc is
updated); the FE never silently absorbs a wire mismatch in a test fixture either — mock
payloads must mirror the documented contract.

Reuse the existing infrastructure instead of inventing parallel harnesses:

| Use…                                               | For…                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/shared/ipc-mock-router.ts`                    | Single in-memory mock router — register per-channel `invoke` handlers and emit mock events.          |
| `src/shared/ipc/request-validation.ts` (+ schemas) | Zod schemas + `validateIpcRequest` / `tryValidateIpcRequest` to assert the request matches contract. |
| `src/shared/ipc/__tests__/contracts.test.ts`       | Reference pattern for asserting IPC contracts and request schemas — extend it for new methods.       |
| `src/test-setup.ts`                                | Vitest global setup (Electron mocks, jsdom shims, temp workspace dir). New suites get this for free. |
| `src/test/layer-exit.ts`                           | Unit tests closing menus/dialogs: `waitForLayerExit(el)`, `pressOutsideLayer(el)` (jsdom-safe).      |

Run the targeted suite with `pnpm vitest run <files>` (see [Verification](#verification)
above) before opening a PR.

## Filing issues

File bugs on [intent-hq/intent](https://github.com/intent-hq/intent/issues) with labels
`component:fe` + `agent-filed`; never track issues in markdown files. Put `Fixes
intent-hq/intent#N` on every fix PR: the release notifier
(`scripts/notify-fixed-issues.sh`) comments on a closed issue only once at least one
linked fix PR has merged, every merged one across cloudlands-fe and intentd is in a
release, and none is still open (PRs closed without merging are ignored); a plain mention
never earns a comment. Dedup and cross-referencing: [root `AGENTS.md` → Filing
Issues](https://github.com/intent-hq/intent/blob/main/AGENTS.md#filing-issues).

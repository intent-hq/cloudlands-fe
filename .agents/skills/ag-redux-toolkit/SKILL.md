---
name: ag-redux-toolkit
description: >-
  Repository root router for ag-redux-toolkit skills. Start here to choose
  ./svelte/SKILL.md only for frontend-facing Svelte/SvelteKit paths with concrete
  Svelte evidence, ./streaming/SKILL.md for Node/server/workers/CLIs/test harnesses
  or no-UI code paths by default, and ./core/SKILL.md for shared Redux,
  redux-saga concepts, or explicit Redux store pruning requests. Use
  ./setup/SKILL.md for first-time app setup. Svelte
  and Streaming Store app patterns are mutually exclusive choices for any
  single app.
type: core
sources:
  - ./setup/SKILL.md
  - ./core/SKILL.md
  - ./svelte/SKILL.md
  - ./streaming/SKILL.md
  - augmentcode/ag-redux-toolkit:README.md
  - augmentcode/ag-redux-toolkit:docs/ARCHITECTURE.md
triggers:
  - ag-redux-toolkit
  - skill router
  - root skill router
  - Store routing
  - greenfield setup
  - StreamingStore
  - Svelte + Redux
  - Redux saga
  - Redux store pruning
  - selector lifecycle
  - Node store
---
# ag-redux-toolkit skill router

> **Runtime status — the `@augmentcode/ag-redux-toolkit`, `redux`, `redux-saga`,
> and `typed-redux-saga` packages have been removed from this app.** The in-use
> toolkit subpaths now resolve to a local redux/saga-free shim at
> `src/lib/store-shim/` (via `tsconfig*.json` / `vite.config.mjs` /
> `vitest.config.ts` aliases and `scripts/fix-esm-imports.ts` for main/preload).
> The saga runtime is gone: `store.runSaga(sagaFn)` is a no-op, `startAllAppSagas`
> / `startAllMainSagas` no longer start anything, and `selector.effect(...)`
> throws — use `selector.select(state, ...args)` and `store.dispatch(action)`.
> The action/reducer/selector/collection APIs below still apply; saga-runtime and
> StreamingStore-engine guidance is historical context for this app.

Use this repository root skill first when choosing package guidance. Its job isrouting only: load `./setup/SKILL.md` for first-time app setup, load the family that matches the environment and touched code path,then load the leaf skills named by that family. Do not treat this file as areplacement index for `./setup/`, `./core/`, `./svelte/`, or `./streaming/`.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not usecreateSlice, configureStore, createAsyncThunk, or any RTK API.

## App-level Store family rule

- **Svelte Store and Streaming Store patterns are mutually exclusive fora single app.** One app must choose exactly one concrete Store family:`Store` plus Svelte readable/component lifecycle patterns, or`StreamingStore` plus Kefir/observable selector patterns.
- Do not mix `./svelte/` and `./streaming/` concrete Store guidance forthe same app, package entry, runtime, or code path. `./core/` may be pairedwith the one selected concrete family because it is shared Redux/redux-sagaguidance, not a second Store family.
- Mixed repositories must route per app/package/code path. Separate apps in thesame repository may choose different families, but one app must not usepatterns from multiple concrete Store families.

## Routing decision order

1. **Shared Redux or saga concept only → **`./core/`**.** Use core for actioncreators, reducers, state modeling, serializability, typed-redux-saga flows,saga manager behavior, selector channels, `waitFor`, explicit Redux store pruning, testing, debugging, andverifier handoff that apply across Store families.
2. **Frontend-facing plus Svelte/SvelteKit evidence → **`./svelte/`**.** UseSvelte only when the target app/code path is UI/frontend-facing and there isconcrete Svelte or SvelteKit evidence: a Svelte dependency, `svelte.config.*`,`.svelte` component files, SvelteKit `+layout`/`+page` files, imports from`svelte`, `Store` from `@augmentcode/ag-redux-toolkit/svelte-store`, orSvelte readable/template integration. Generic browser or web work is notenough. Do not also apply StreamingStore/Kefir selector,setup, or lifecycle guidance to that same app.
3. **Node/server/no-UI path → **`./streaming/`** by default.** UseStreaming for Node services, server routes, background workers, CLIs, scripts,test harnesses, Kefir/observable selectors, `StreamingStore`, or any app/codepath where concrete Svelte UI evidence is absent. Absence of UI evidence defaults toStreaming. Do not also apply Store/readable/component/setup or signal-render guidance to that same app.
4. **Mixed repositories route by the task path.** A repository-level Svelte dependency does not make every change UI-specific. Classify the specificfiles and behavior being changed, then choose Core plus at most one concreteStore family for each app/package/code path.

## Route matrix

| Situation | Read these skills |
| --- | --- |
| First-time app setup or greenfield Store wiring | ./setup/SKILL.md plus exactly one matching family router and any needed core leaves |
| Redux ownership, actions, reducers, serializable state, typed-redux-saga, selector channels, or tests with no Store-variant behavior | ./core/SKILL.md plus matching core leaves |
| Explicit request to prune unused Redux store selectors, actions, handlers, sagas, or orphaned store logic | ./core/SKILL.md plus ./core/store-pruning/SKILL.md; do not apply pruning automatically to unrelated work |
| Svelte component setup, SvelteKit root layout wiring, Svelte readable selector calls, $selector template usage, or migration from Svelte stores/runes | ./svelte/SKILL.md plus matching Svelte leaves and any needed core leaves |
| Node services, server modules, background jobs, package scripts, CLIs, tests, Kefir streams, observable selector arguments, or StreamingStore | ./streaming/SKILL.md plus matching Streaming leaves and any needed core leaves |
| A mixed task that touches reducer policy and Svelte component wiring | ./core/SKILL.md for shared policy and ./svelte/SKILL.md for component/readable behavior |
| A mixed task that touches reducer policy and Streaming selector behavior | ./core/SKILL.md for shared policy and ./streaming/SKILL.md for observable behavior |
| A mixed repository with a Svelte frontend and a separate Node worker app | Route the frontend app to ./svelte/ and the worker app to ./streaming/ separately; do not mix both concrete Store families inside either app |

## Consumer skill install routing

When a consuming app asks how to install packaged AI skills, use the same evidence as the routing decision above and recommend the smallest matching bundle:

- Svelte/SvelteKit evidence → `npx ag-redux-toolkit install-skills:svelte` (root router plus `setup`, `core`, and `svelte`).
- Streaming, Node/server/worker/CLI/test/no-UI, observable evidence, or no concrete UI evidence → `npx ag-redux-toolkit install-skills:streaming` (root router plus `setup`, `core`, and `streaming`).
- Shared Redux/redux-saga guidance only → `npx ag-redux-toolkit install-skills:core` (root router plus `setup` and `core`).
- Use `npx ag-redux-toolkit install-skills` or `npx ag-redux-toolkit install-skills:all` only when every package skill family is intentionally needed.

Domain-specific installs refresh stale package-owned files only in the selected bundle scope and preserve unrelated project/third-party skills plus non-selected package skill families. The all-skills flow refreshes all package-owned skill families while still preserving unrelated skills. Package installation itself never copies skills automatically.

## Evidence to record in handoff

- The code path classified as frontend/Svelte, Node/server/Streaming, or sharedCore, with the concrete evidence used and the single concrete Store familychosen for that app.
- The exact skill family and leaf skills read.
- For mixed repositories, why repository-wide dependencies did or did not affectthe specific path being changed.
- Confirmation that the same app/package/code path did not mix Svelte andStreaming Store concrete patterns.
- Verification that no placeholder, shim-only, or barrel-only skill replaced themeaningful core, Svelte, or Streaming directory roots.
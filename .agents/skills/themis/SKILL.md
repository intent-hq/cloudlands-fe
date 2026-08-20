---
name: themis
description: >-
  Repository root router for themis skills. Start here to choose
  ./svelte/SKILL.md only for frontend-facing Svelte/SvelteKit paths with concrete
  Svelte evidence, ./react/SKILL.md for React UI paths using ReactStore and
  Preact signals, ./streaming/SKILL.md for Node/server/workers/CLIs/test harnesses
  or no-UI code paths by default, and ./core/SKILL.md for shared Redux,
  redux-saga concepts, or explicit Redux store pruning requests. Use
  ./setup/SKILL.md for first-time app setup. Svelte,
  React, and Streaming Store app patterns are mutually exclusive choices for any
  single app.
type: core
sources:
  - ./setup/SKILL.md
  - ./core/SKILL.md
  - ./svelte/SKILL.md
  - ./react/SKILL.md
  - ./streaming/SKILL.md
  - "@augmentcode/themis/README.md"
  - "@augmentcode/themis/docs/ARCHITECTURE.md"
triggers:
  - themis
  - skill router
  - root skill router
  - Store routing
  - greenfield setup
  - StreamingStore
  - ReactStore
  - Svelte + Redux
  - React signals
  - Redux saga
  - Redux store pruning
  - selector lifecycle
  - Node store
---
# themis skill router

Use this repository root skill first when choosing package guidance. Its job isrouting only: load `./setup/SKILL.md` for first-time app setup, load the family that matches the environment and touched code path,then load the leaf skills named by that family. Do not treat this file as areplacement index for `./setup/`, `./core/`, `./svelte/`, `./react/`, or `./streaming/`.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not usecreateSlice, configureStore, createAsyncThunk, or any RTK API.

## App-level Store family rule

- **Svelte Store, React Store, and Streaming Store patterns are mutually exclusive fora single app.** One app must choose exactly one concrete Store family:`Store` plus Svelte readable/component lifecycle patterns, `ReactStore` plus Preact signal/React `.useValue(...)` patterns, or`StreamingStore` plus Kefir/observable selector patterns.
- Do not mix `./svelte/`, `./react/`, and `./streaming/` concrete Store guidance forthe same app, package entry, runtime, or code path. `./core/` may be pairedwith the one selected concrete family because it is shared Redux/redux-sagaguidance, not a second Store family.
- Mixed repositories must route per app/package/code path. Separate apps in thesame repository may choose different families, but one app must not usepatterns from multiple concrete Store families.

## Selector output cache routing

- Cached direct selector outputs are not Svelte-only. Route Svelte readable cache guidance to `./svelte/selectors/SKILL.md` and `./svelte/selector-scheduling/SKILL.md`.
- Route React `ReadonlySignal` cache guidance to `./react/selectors/SKILL.md` and `./react/selector-scheduling/SKILL.md`; direct signal calls are preferred where valid.
- Route Streaming/Kefir `Observable` cache guidance to `./streaming/selectors/SKILL.md` and `./streaming/selector-lifecycle/SKILL.md`; prefer same selector+args over manual stream passing where valid.

## Universal architecture rule — effects live in sagas, not components

This rule applies to EVERY family below (Svelte, React, Streaming, Core). Components render and dispatch only. **Do NOT create new custom hooks, React `useEffect`, or Svelte `$effect` that contain business logic or side effects** — API calls, persistence/localStorage, timers, subscriptions, event listeners, IPC/websocket, or async workflows. Those belong in sagas. Dispatch an action from the component and handle the work in a saga.

The ONLY permitted component effects are DOM-local: focus, scroll, measurement, and third-party widget lifecycle that cannot live elsewhere. Anything else is a violation.

For the canonical statement of this rule and for migrating any existing effects into sagas, see `./core/core-policy/SKILL.md` §3, `./react/migration/side-effects/SKILL.md`, and `./svelte/migration/side-effects/SKILL.md`.

## Routing decision order

1. **Shared Redux or saga concept only → **`./core/`**.** Use core for actioncreators, reducers, state modeling, serializability, typed-redux-saga flows,saga manager behavior, selector channels, `waitFor`, explicit Redux store pruning, testing, debugging, andverifier handoff that apply across Store families.
2. **Frontend-facing plus Svelte/SvelteKit evidence → **`./svelte/`**.** UseSvelte only when the target app/code path is UI/frontend-facing and there isconcrete Svelte or SvelteKit evidence: a Svelte dependency, `svelte.config.*`,`.svelte` component files, SvelteKit `+layout`/`+page` files, imports from`svelte`, `Store` from `@augmentcode/themis/svelte-store`, orSvelte readable/template integration. Generic browser or web work is notenough. Do not also apply ReactStore/signals or StreamingStore/Kefir selector,setup, or lifecycle guidance to that same app.
3. **Frontend-facing plus React evidence → **`./react/`**.** Use React when thetarget app/code path imports React, uses JSX/TSX React components/hooks, imports`ReactStore` from `@augmentcode/themis/react-store`, or expects Preact React signal selectors/`.useValue(...)` component reads. Do not also apply Svelte readable orStreamingStore/Kefir guidance to that same app.
4. **Node/server/no-UI path → **`./streaming/`** by default.** UseStreaming for Node services, server routes, background workers, CLIs, scripts,test harnesses, Kefir/observable selectors, `StreamingStore`, or any app/codepath where concrete Svelte or React UI evidence is absent. Absence of UI evidence defaults toStreaming. Do not also apply Store/readable/component/setup, React `.useValue(...)`, or signal-render guidance to that same app.
5. **Mixed repositories route by the task path.** A repository-level Svelte orReact dependency does not make every change UI-specific. Classify the specificfiles and behavior being changed, then choose Core plus at most one concreteStore family for each app/package/code path.

## Route matrix

| Situation | Read these skills |
| --- | --- |
| First-time app setup or greenfield Store wiring | ./setup/SKILL.md plus exactly one matching family router and any needed core leaves |
| Redux ownership, actions, reducers, serializable state, typed-redux-saga, selector channels, or tests with no Store-variant behavior | ./core/SKILL.md plus matching core leaves |
| Explicit request to prune unused Redux store selectors, actions, handlers, sagas, or orphaned store logic | ./core/SKILL.md plus ./core/store-pruning/SKILL.md; do not apply pruning automatically to unrelated work |
| Svelte component setup, SvelteKit root layout wiring, Svelte readable selector calls, $selector template usage, or migration from Svelte stores/runes | ./svelte/SKILL.md plus matching Svelte leaves and any needed core leaves |
| React component setup, ReactStore imports, Preact React signal selectors, direct signal reads, selector .useValue(...args), React selector lifecycle/scheduling, or React migration/adoption work | ./react/SKILL.md plus matching React leaves (`react/store`, `react/selectors`, `react/component-integration`, `react/selector-lifecycle`, `react/selector-scheduling`, `react/migration/**`) and any needed core leaves |
| Node services, server modules, background jobs, package scripts, CLIs, tests, Kefir streams, observable selector arguments, or StreamingStore | ./streaming/SKILL.md plus matching Streaming leaves and any needed core leaves |
| A mixed task that touches reducer policy and Svelte component wiring | ./core/SKILL.md for shared policy and ./svelte/SKILL.md for component/readable behavior |
| A mixed task that touches reducer policy and Streaming selector behavior | ./core/SKILL.md for shared policy and ./streaming/SKILL.md for observable behavior |
| A mixed repository with a Svelte frontend and a separate Node worker app | Route the frontend app to ./svelte/ and the worker app to ./streaming/ separately; do not mix both concrete Store families inside either app |

## Consumer skill install routing

When a consuming app asks how to install packaged AI skills, use the same evidence as the routing decision above and recommend the smallest matching bundle:

- React evidence → `npx themis install-skills:react` (root router plus `setup`, `core`, and `react`).
- Svelte/SvelteKit evidence → `npx themis install-skills:svelte` (root router plus `setup`, `core`, and `svelte`).
- Streaming, Node/server/worker/CLI/test/no-UI, observable evidence, or no concrete UI evidence → `npx themis install-skills:streaming` (root router plus `setup`, `core`, and `streaming`).
- Shared Redux/redux-saga guidance only → `npx themis install-skills:core` (root router plus `setup` and `core`).
- Use `npx themis install-skills` or `npx themis install-skills:all` only when every package skill family is intentionally needed.

Package installation itself never copies skills automatically. Explicit installs copy to `.agents/skills/themis/`, create or reuse `.claude/skills/themis` as its compatibility link, and preserve collisions with a warning. Repeating a command refreshes package-owned files from its manifest; `npx themis cleanup-skills` removes owned files and links before uninstall. Read the canonical workflow in [@augmentcode/themis/docs/INSTALLATION.md](@augmentcode/themis/docs/INSTALLATION.md) for destination, refresh, verification, cleanup, and maintainer details.

## Evidence to record in handoff

- The code path classified as frontend/Svelte, frontend/React, Node/server/Streaming, or sharedCore, with the concrete evidence used and the single concrete Store familychosen for that app.
- The exact skill family and leaf skills read.
- For mixed repositories, why repository-wide dependencies did or did not affectthe specific path being changed.
- Confirmation that the same app/package/code path did not mix Svelte, React, andStreaming Store concrete patterns.
- Verification that no placeholder, shim-only, or barrel-only skill replaced themeaningful core, Svelte, React, or Streaming directory roots.
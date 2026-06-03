---
name: ag-redux-toolkit
description: >-
  Repository root router for ag-redux-toolkit skills. Start here to choose
  ./svelte/SKILL.md only for frontend-facing Svelte/SvelteKit paths with concrete
  Svelte evidence, ./streaming/SKILL.md for Node/server/workers/CLIs/test harnesses
  or no-Svelte code paths by default, and ./core/SKILL.md for shared Redux and
  redux-saga concepts. Svelte and Streaming Store app patterns are mutually
  exclusive choices for any single app.
type: core
sources:
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
  - StreamingStore
  - Svelte + Redux
  - Redux saga
  - selector lifecycle
  - Node store
---
# ag-redux-toolkit skill router

Use this repository root skill first when choosing package guidance. Its job isrouting only: load the family that matches the environment and touched code path,then load the leaf skills named by that family. Do not treat this file as areplacement index for `./core/`, `./svelte/`, or `./streaming/`.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not usecreateSlice, configureStore, createAsyncThunk, or any RTK API.

## App-level Store family rule

- **Svelte Store patterns and Streaming Store patterns are mutually exclusive fora single app.** One app must choose exactly one concrete Store family:`Store` plus Svelte readable/component lifecycle patterns, or`StreamingStore` plus Kefir/observable selector patterns.
- Do not mix `./svelte/` and `./streaming/` concrete Store guidance forthe same app, package entry, runtime, or code path. `./core/` may be pairedwith the one selected concrete family because it is shared Redux/redux-sagaguidance, not a second Store family.
- Mixed repositories must route per app/package/code path. Separate apps in thesame repository may choose different families, but one app must not usepatterns from both concrete Store families.

## Routing decision order

1. **Shared Redux or saga concept only → **`./core/`**.** Use core for actioncreators, reducers, state modeling, serializability, typed-redux-saga flows,saga manager behavior, selector channels, `waitFor`, testing, debugging, andverifier handoff that apply to both Svelte-readable and Streaming users.
2. **Frontend-facing plus Svelte/SvelteKit evidence → **`./svelte/`**.** UseSvelte only when the target app/code path is UI/frontend-facing and there isconcrete Svelte or SvelteKit evidence: a Svelte dependency, `svelte.config.*`,`.svelte` component files, SvelteKit `+layout`/`+page` files, imports from`svelte`, `Store` from `ag-redux-toolkit/svelte-store`, orSvelte readable/template integration. Generic browser or web work is notenough. Do not also apply StreamingStore/Kefir selector, setup, or lifecycleguidance to that same app.
3. **Node/server/non-Svelte path → **`./streaming/`** by default.** UseStreaming for Node services, server routes, background workers, CLIs, scripts,test harnesses, Kefir/observable selectors, `StreamingStore`, or any app/codepath where Svelte evidence is absent. Absence of Svelte evidence defaults toStreaming, not Svelte. Do not also apply Store/readable/component/setupor lifecycle guidance to that same app.
4. **Mixed repositories route by the task path.** A repository-level Sveltedependency does not make every change Svelte-specific. Classify the specificfiles and behavior being changed, then choose Core plus at most one concreteStore family for each app/package/code path.

## Route matrix

| Situation | Read these skills |
| --- | --- |
| Redux ownership, actions, reducers, serializable state, typed-redux-saga, selector channels, or tests with no Store-variant behavior | ./core/SKILL.md plus matching core leaves |
| Svelte component setup, SvelteKit root layout wiring, Svelte readable selector calls, $selector template usage, or migration from Svelte stores/runes | ./svelte/SKILL.md plus matching Svelte leaves and any needed core leaves |
| Node services, server modules, background jobs, package scripts, CLIs, tests, Kefir streams, observable selector arguments, or StreamingStore | ./streaming/SKILL.md plus matching Streaming leaves and any needed core leaves |
| A mixed task that touches reducer policy and Svelte component wiring | ./core/SKILL.md for shared policy and ./svelte/SKILL.md for component/readable behavior |
| A mixed task that touches reducer policy and Streaming selector behavior | ./core/SKILL.md for shared policy and ./streaming/SKILL.md for observable behavior |
| A mixed repository with a Svelte frontend and a separate Node worker app | Route the frontend app to ./svelte/ and the worker app to ./streaming/ separately; do not mix both concrete Store families inside either app |

## Evidence to record in handoff

- The code path classified as frontend/Svelte, Node/server/Streaming, or sharedCore, with the concrete evidence used and the single concrete Store familychosen for that app.
- The exact skill family and leaf skills read.
- For mixed repositories, why repository-wide dependencies did or did not affectthe specific path being changed.
- Confirmation that the same app/package/code path did not mix Svelte andStreaming Store concrete patterns.
- Verification that no placeholder, shim-only, or barrel-only skill replaced themeaningful core, Svelte, or Streaming directory roots.
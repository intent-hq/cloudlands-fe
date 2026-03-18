# State Management Guide

## Overview

State should be kept out of Svelte components as much as possible. The canonical home for shared or durable application state in this codebase is Redux under `src/lib/store/`.

Components should primarily render UI, read selector-backed state, and dispatch actions. Business logic, shared state, derived state, persistence, async workflows, and cross-component coordination should live in Redux slices, selectors, and sagas.

## Core Policy

### 1. Prefer Redux for all non-trivial state

Use Redux whenever state is:

- Shared by more than one component
- Needed by services or non-Svelte code
- Persisted to storage or synchronized over IPC/network
- The basis for business logic or workflows
- Derived in multiple places

If state needs to be shared with other components, it should be in the Redux store in `src/lib/store/`.

### 2. Keep components focused on rendering

Components should represent rendering logic, event wiring, and small amounts of ephemeral UI state that are directly tied to a single rendered instance.

Good component-local state examples:

- Temporary open/closed UI state for one component
- Focus state, hover state, draft input text not shared elsewhere
- DOM measurement or instance-specific widget state

If a component starts accumulating business rules, coordinating multiple concerns, or maintaining state that other components care about, move that state and logic into Redux.

### 3. Put side effects in sagas

Side effects should be implemented in Redux sagas.

That includes:

- API and IPC calls
- `localStorage` / persistence
- timers, polling, retries, debouncing
- event listeners and subscriptions
- multi-step workflows and orchestration
- reacting to state changes that matter outside a single component

Use `$effect` only when it is absolutely necessary and the effect is directly related to the component instance itself.

Acceptable `$effect` usage is narrow:

- Imperative DOM synchronization for the mounted component
- Focus/scroll/measurement work tied to that component
- Third-party widget lifecycle code that cannot reasonably live elsewhere

Do **not** use component `$effect` for application workflows, persistence, shared-state coordination, or async business logic when saga-based handling is possible.

### 4. Treat Svelte store classes as migration targets

State in Svelte store classes should also be implemented as Redux slices. Existing Svelte stores are transitional and should be migrated into `src/lib/store/slices/` over time.

The migration direction in this repository is explicit:

- each Svelte store maps to one Redux slice
- side effects move to sagas
- getters / `$derived` values move to selectors
- old store files are eventually deleted once migration is complete

Do not introduce new long-lived app/domain state in `.store.svelte.ts` classes unless there is a very strong, temporary reason.

## Recommended Architecture

### Components

Components should:

- read state through selectors
- dispatch Redux actions
- keep only minimal instance-local UI state
- avoid embedding business rules

### Redux slices

Redux slices should own:

- serializable state
- pure state transitions
- action definitions
- domain boundaries for shared state

### Selectors

Selectors should own:

- derived state
- view-ready transformations
- memoized, reusable reads from store state

### Sagas

Sagas should own:

- side effects
- async work
- coordination across actions/domains
- response to store changes when that response is broader than a single component

## Why Redux is preferred over component state

Redux is the better default for shared application state in this codebase because it provides:

### Single source of truth

Shared state in Redux avoids duplicating the same state across multiple components or custom stores.

### Better separation of concerns

Reducers stay pure, sagas handle effects, selectors derive values, and components render. This makes each layer easier to understand and change.

### Better testability

Pure reducers and selector functions are straightforward to test, and saga workflows have established testing patterns. Business logic inside components is much harder to test in isolation.

### Better performance characteristics

The existing Redux architecture already documents selector optimization, memoization, batching, and normalized state patterns. Reusing that system is better than scattering ad hoc state across components.

### Better debugging and tooling

Redux state is designed to be serializable and observable. The store is initialized centrally and exposed with debugging support in development, which is not true for arbitrary component-owned state.

### Better integration beyond Svelte components

This codebase already includes a Redux dispatch bridge for non-Svelte code and central saga startup. Shared state in Redux can be accessed and coordinated consistently across components, services, and background workflows.

## Practical Rules

### Put it in Redux when...

- Another component needs it
- A saga needs to react to it
- It must survive navigation, persistence, or reload
- It represents domain/application state rather than temporary UI state
- It drives workflows, orchestration, or cross-feature coordination

### Keep it in the component when...

- It is purely visual and instance-local
- It only matters while this one component is mounted
- It is not shared, persisted, or part of business logic

### Reach for `$effect` only when...

- The effect is directly tied to this component's rendered DOM
- The lifecycle is inherently component-local
- Moving it to a saga would add complexity without improving ownership

If you are unsure, prefer Redux.

## Existing Redux References

The Redux documentation already living in `src/lib/store/docs/` should be treated as the primary reference set:

- `src/lib/store/docs/readme.md` — index of all Redux docs
- `src/lib/store/docs/REDUX_ARCHITECTURE_GUIDE.md` — overall architecture, actions, sagas, performance
- `src/lib/store/docs/REDUCERS_GUIDE.md` — reducer patterns and state rules
- `src/lib/store/docs/SELECTORS_GUIDE.md` — selector design and usage
- `src/lib/store/docs/WAITFOR_SAGA_GUIDE.md` — waiting on store conditions in sagas
- `src/lib/store/docs/MIGRATION_GUIDE.md` — how existing Svelte stores migrate to Redux slices

## Codebase Alignment

This guidance matches the current store architecture in the repository:

- `src/lib/store/init.ts` creates the Redux store and runs sagas
- `src/lib/store/components/Store.svelte` installs the store context and starts registered sagas
- `src/lib/store/utils/utils.ts` exposes `getDispatch()` for components to dispatch actions
- `src/lib/store/sagas.ts` is the registry for saga-based side effects

## Migration Direction

The long-term direction is to consolidate state management around Redux.

- New shared state should be implemented as Redux slices
- New side effects should be implemented as sagas
- Existing Svelte store classes should be migrated rather than expanded
- Components should get thinner over time, with business logic moving out of the view layer

In short: keep state and business logic out of components whenever possible, use Redux for shared state, use sagas for side effects, and treat remaining Svelte stores as temporary migration candidates.
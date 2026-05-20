---
name: migrate-to-svelte-redux-toolkit/derived-stores
description: >-
  Convert derived() stores and $derived runes into store.createSelector when a
  configured Store exists, composing with upstream selectors via .select(state).
  Covers Svelte 4 derived() and Svelte 5 $derived / getter conversion.
type: sub-skill
requires:
  - svelte-redux-toolkit/selectors
  - migrate-to-svelte-redux-toolkit
triggers:
  - migrate derived
  - migrate $derived
  - derived to selector
  - convert derivation
---
# Migration — `derived` / `$derived` → `store.createSelector`

> App-level `derived()` stores and shared `$derived` values become named
> selectors created from the configured app `Store`. Compose selectors with
> `.select(state)` inside selector bodies, call the readable form only during
> component initialization, and use `.effect(...)` from sagas.

## Examples

### 1. Before: shared `derived()` store slated for migration

```typescript
// migration/counter-derived-before.ts
import { derived, writable } from "svelte/store";

export const count = writable(0);
export const username = writable("Ada");
export const doubled = derived(count, ($count) => $count * 2);
export const greeting = derived(username, ($name) => `Hello, ${$name}!`);
```

### 2. After: no-argument selectors with `.select(state)` composition

```typescript
// src/lib/store/slices/counter/counter-selectors.ts
import { store } from "$lib/store/store";

export const selectCount = store.createSelector((state) => state.counter.count);
export const selectUsername = store.createSelector((state) => state.counter.username);
export const selectDoubled = store.createSelector((state) => selectCount.select(state) * 2);
export const selectGreeting = store.createSelector((state) => {
  return `Hello, ${selectUsername.select(state)}!`;
});
```

### 3. Parameterized selectors replace functions that returned `derived()` stores

```typescript
// src/lib/store/slices/todos/todos-selectors.ts
import { store } from "$lib/store/store";

type Todo = { id: string; title: string; projectId: string; completed: boolean };

export const selectTodos = store.createSelector((state) => state.todos.items as Todo[]);
export const selectTodosForProject = store.createSelector((state, projectId: string) => {
  return selectTodos.select(state).filter((todo) => todo.projectId === projectId);
});
```

### 4. Svelte 5 `$derived`/getter source becomes serializable state plus selectors

```typescript
// migration/profile-runes-before.svelte.ts
declare function $state<T>(value: T): T;
declare function $derived<T>(value: T): T;

export const profile = $state({ firstName: "Ada", lastName: "Lovelace" });
export const displayName = $derived(`${profile.firstName} ${profile.lastName}`);
```

```typescript
// src/lib/store/slices/profile/profile-selectors.ts
import { store } from "$lib/store/store";

export const selectProfile = store.createSelector((state) => state.profile);
export const selectDisplayName = store.createSelector((state) => {
  const profile = selectProfile.select(state);
  return `${profile.firstName} ${profile.lastName}`;
});
```

### 5. Components consume migrated selectors as readables at initialization

```typescript
// src/lib/components/ProfileSummary.svelte.ts
import { selectDisplayName, selectProfile } from "$lib/store/slices/profile/profile-selectors";

export const profile$ = selectProfile();
export const displayName$ = selectDisplayName();
export const profileTemplateBindings = { profile$, displayName$ };
```

### 6. Sagas read migrated derived values with `.effect(...)`

```typescript
// src/lib/store/slices/profile/sagas/profile-saga.ts
import { call, takeLatest } from "typed-redux-saga";
import { profileSaved } from "../profile-slice";
import { selectDisplayName } from "../profile-selectors";

function* announceProfileSaved() {
  const displayName = yield* selectDisplayName.effect();
  yield* call(console.info, `Saved ${displayName}`);
}

export function* profileSaga() {
  yield* takeLatest(profileSaved, announceProfileSaved);
}
```

### 7. ❌ Bad: inline derivation duplicates ownership and can read stale state

```typescript
// ❌ BAD: recomputes a migrated derived value in a handler instead of using the selector owner.
type AppState = { todos: { items: Array<{ id: string; completed: boolean }> } };
type AppStore = { state: AppState; dispatch(action: { type: string; payload?: unknown }): void };

declare const store: AppStore;
declare const selectCompletedCount: { select(state: AppState): number };
declare function saveCompletedCount(count: number): { type: string; payload: [number] };

export function badSaveCompletedCount() {
  const completed = store.state.todos.items.filter((todo) => todo.completed).length;
  store.dispatch(saveCompletedCount(completed));
}

export function goodSaveCompletedCount() {
  const completed = selectCompletedCount.select(store.state);
  store.dispatch(saveCompletedCount(completed));
}
```

## Rules

- One selector per derived expression — keep selectors narrow so proxy-tracking
  memoization can short-circuit re-computation.
- Compose upstream selectors with `upstream.select(state)` inside the body;
  never call `upstream()` there because that is the component-init readable mode.
- For selectors parameterized by an id or key, put the arguments on
  `store.createSelector((state, arg) => ...)` instead of creating a new selector
  per call site.
- For reading a migrated derived value from a saga, use
  `yield* selectFoo.effect(args)`; for event handlers and tests, use
  `selectFoo.select(store.state, args)`.

## Cross-References

- `skills/svelte-redux-toolkit/selectors/SKILL.md` — selector factory and call modes
- `skills/svelte-redux-toolkit/selector-lifecycle/SKILL.md` — readable / direct / saga usage
- `skills/migrate-to-svelte-redux-toolkit/component-migration/SKILL.md` — component consumption after selector migration


---
name: core/testing
description: >-
  Required vi.mock("typed-redux-saga") boilerplate mapping each effect to
  redux-saga/effects so redux-saga-test-plan can interpret them (the call
  mock MUST use Array.isArray to handle [context, method] tuple calls).
  Use expectSaga for integration (.withState / .put / .call / .provide /
  .dispatch / .silentRun) and testSaga for step-by-step (.next / .fork /
  .isDone). Reducer tests are pure — assert reference equality on no-op
  actions. State-integrity verification must prove derived values live in
  selectors and action/selector/saga owners are not duplicated. Source:
  @augmentcode/themis/docs/TESTING.md, ../SKILL.md §14.
type: sub-skill
library: themis
requires:
  - core
  - core/sagas
  - core/state-integrity
sources:
  - "@augmentcode/themis/docs/TESTING.md"
  - ../SKILL.md
triggers:
  - vi mock typed-redux-saga
  - expectSaga integration
  - testSaga stepwise
  - saga test plan
---
# Testing — reducer, selector, and saga checks

> Operational testing checklist. Human-facing examples: `@augmentcode/themis/docs/TESTING.md`. Saga effect details: `../sagas/SKILL.md`. Source: `../SKILL.md` §14.

## Use when

- Adding or updating tests for reducers, selectors, collections, async actions, or sagas.
- Reviewing state-integrity evidence for changed state/actions/selectors/sagas.
- Debugging redux-saga-test-plan matcher failures.

## Layer rules

| Layer | Test style | Required cues |
| --- | --- | --- |
| Reducers | Direct function calls | Initial state, each handled action, unknown/no-op same reference, serializable state when shape changes. |
| Collections | Reducer/selector tests | Assert via `getItem`, `getItems`, or selector helpers; include no-op reference checks. |
| Selectors | Pure `.select(mockState, ...)` calls | Never invoke readable selector form in Vitest. Test composition separately and together. |
| Sagas | `expectSaga` or `testSaga` | Mock `typed-redux-saga`, stub calls with `redux-saga-test-plan/matchers`, use `silentRun`. |

## Saga test setup cues

- Mock only the `typed-redux-saga` effects the file uses and map them to `redux-saga/effects` before importing the saga under test.
- The `call` mock must branch on `Array.isArray(fnOrDescriptor)` so `[context, method]` tuple calls work.
- In assertions and matchers, use `redux-saga/effects` descriptors or `redux-saga-test-plan` APIs, not descriptors imported from `typed-redux-saga`.
- Use `expectSaga` for behavior/integration and `testSaga` for order-sensitive generator steps such as root saga fork order.

## State-integrity evidence

- Reducer tests assert canonical fields only; derived values are tested through selectors.
- Selector tests cover derived outputs instead of stored `filtered*`, `*Count`, `has*`, or selected entity copies.
- Handoff names the canonical owner for each new action, selector, or saga, or states that none was added.
- Search evidence lists terms/paths used to rule out duplicate action types, selectors, saga watchers, and registrations.

## Don't

- Do not call `selector()` in tests; use `.select(state)`.
- Do not use real long timers in saga tests; prefer `.silentRun(0)` or a short bounded duration.
- Do not approve tests that assert reducer-maintained derived fields when selectors should own that value.
- Do not omit no-op reference checks for reducers or collection updates that should preserve identity.
- Do not leave one-line re-export/proxy wrapper files after refactors unless an adjacent compatibility comment documents the consumer, release window, and removal condition.

## Example list

1. Good: `typed-redux-saga` Vitest mock with the required tuple-aware `call` guard.
2. Good: reducer tests for handled actions, async failure, and no-op reference equality.
3. Good: selector tests that assert derived output through `.select(state, ...args)`.
4. Good: `expectSaga` integration test that provides selector effects and API calls.
5. Good: `testSaga` stepwise root-saga watcher assertion.
6. Bad: realistic tests that assert stored derived state, call readable selector mode, and miss selector-effect providers.

## Cases covered

| Case | Example |
| --- | --- |
| Saga test setup maps typed effects to `redux-saga/effects` and keeps `[context, method]` calls working. | 1 |
| Reducer tests prove handled branches and same-reference no-op behavior. | 2 |
| Selector tests cover derived values through public `.select` instead of reducer-owned derived fields. | 3 |
| Saga integration tests provide `selector.effect()` and API effects before asserting `put`s. | 4 |
| Stepwise saga tests are reserved for order-sensitive watcher/root-saga checks. | 5 |
| Bad examples teach non-trivial review failures that compile but can produce misleading tests. | 6 |

## Examples

### 1. Mock `typed-redux-saga` with a tuple-aware `call` guard

```ts
import { vi } from "vitest";
import * as effects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: (fnOrDescriptor: any, ...args: any[]) =>
    Array.isArray(fnOrDescriptor)
      ? effects.call(fnOrDescriptor, ...args)
      : effects.call(fnOrDescriptor, ...args),
  put: effects.put,
  select: effects.select,
  takeLatest: effects.takeLatest,
}));
```

### 2. Test reducer branches and no-op identity

```ts
import { describe, expect, it } from "vitest";
import { createAction, createAsyncAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type TodosState = { items: string[]; filter: "all" | "open"; loading: boolean; error: string };
const setFilter = createAction<[filter: TodosState["filter"]]>("todos/setFilter");
const loadTodos = createAsyncAction<[query: string], { query: string }, string[]>("todos/loadAsync", "todos/load", (query) => ({ query }));
const initialState: TodosState = { items: [], filter: "all", loading: false, error: "" };
const todosReducer = createReducer(initialState)
  .with(setFilter, (state, { payload: [filter] }) => (state.filter === filter ? state : { ...state, filter }))
  .with(loadTodos, (state) => ({ ...state, loading: true, error: "" }))
  .with(loadTodos.failure, (state, { payload }) => ({ ...state, loading: false, error: payload.error.message }));

describe("todosReducer", () => {
  it("keeps no-op identity and covers async failure", () => {
    const current: TodosState = { ...initialState, filter: "open" };
    expect(todosReducer(current, setFilter("open"))).toBe(current);
    expect(todosReducer({ ...current, loading: true }, loadTodos.failure(new Error("Network"))).error).toBe("Network");
  });
});
```

### 3. Test selector output through `.select(state)`

```ts
import { describe, expect, it } from "vitest";
import { selectTodoCount, selectVisibleTodos } from "./todos-selectors";

const state = {
  todos: {
    items: [{ id: "a", title: "Write tests", completed: false }, { id: "b", title: "Review", completed: true }],
    filter: "open",
  },
};

describe("todo selectors", () => {
  it("derives visible todos from canonical reducer state", () => {
    expect(selectVisibleTodos.select(state).map((todo) => todo.id)).toEqual(["a"]);
    expect(selectTodoCount.select(state)).toBe(2);
  });
});
```

### 4. Use `expectSaga` with provided selector effects

```ts
import { describe, it } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { fetchTodos } from "./todos-api";
import { loadTodos, loadTodosWorker } from "./todos-saga";
import { selectCurrentUserId } from "./todos-selectors";

describe("loadTodosWorker", () => {
  it("loads todos for the selected user", () => {
    const todos = [{ id: "t1", title: "Ship examples", completed: false }];
    return expectSaga(loadTodosWorker, loadTodos("open"))
      .provide([[selectCurrentUserId.effect(), "u1"], [matchers.call.fn(fetchTodos), todos]])
      .put(loadTodos.success(todos))
      .silentRun();
  });
});
```

### 5. Use `testSaga` for root watcher order

```ts
import { describe, it } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import { loadTodos, loadTodosWorker, todosRootSaga } from "./todos-saga";

describe("todosRootSaga", () => {
  it("registers the canonical latest-only watcher", () => {
    testSaga(todosRootSaga)
      .next()
      .takeLatest(loadTodos, loadTodosWorker)
      .next()
      .isDone();
  });
});
```

### 6. ❌ Bad: misleading selector and saga assertions

```ts
import { expect, it } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

// BAD: this test passes syntax checks but validates duplicated derived state, invokes readable mode,
// and forgets to provide the selector effect that the worker reads before calling the API.
it("claims the todo flow works", () => {
  const nextState = todosReducer(state, setFilter("open"));
  expect(nextState.visibleTodos).toEqual([todo]);
  expect(selectVisibleTodos()).toEqual([todo]);

  return expectSaga(loadTodosWorker, loadTodos("open"))
    .provide([[matchers.call.fn(fetchTodos), []]])
    .put(loadTodos.success([]))
    .silentRun();
});
```

## Verification cues

- Run the smallest relevant test scope first, then broader validation if needed.
- Run architecture validation for state/actions/selectors/sagas changes when in scope: `npm run validate:architecture` in this repository, or run ESLint with the app's composed domain root config imported from `@augmentcode/themis/eslint-plugins` in a consuming app.
- Review docs/skills examples after changing them and run the smallest relevant test scope first.
- Manual review should confirm detailed background stays in `@augmentcode/themis/docs/TESTING.md` while this skill keeps only concise, gate-focused examples.

## See also

- `@augmentcode/themis/docs/TESTING.md` — human reference with reducer, selector, saga, and integration examples.
- `core/reducers/SKILL.md` — reducer purity and reference equality.
- Selected Store family selector skill — `.select(state)` selector testing.
- `core/sagas/SKILL.md` — saga effect and watcher conventions.
- `core/state-integrity/SKILL.md` — canonical ownership evidence.
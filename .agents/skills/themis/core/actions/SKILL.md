---
name: core/actions
description: >-
  createAction<[Params]>(type) produces action creators with positional-tuple
  payloads; an optional payloadModifier transforms args into any payload shape.
  createAsyncAction<[Args], SuccessPayload>(asyncType, stagesType) produces a
  request/success/failure triplet plus a promise on each request. Always
  namespace action types as "sliceName/actionName". Action creators expose
  .type and .toString, so they are passed directly to takeEvery/takeLatest —
  never .type. Async creators expose static .success/.failure creators on the
  creator itself, and per-instance success/failure/promise on each dispatched
  action. Each action type has one canonical owner; search for existing action
  creators before adding another.
type: sub-skill
requires:
  - core
  - core/state-integrity
triggers:
  - create action
  - tuple payload
  - async action
  - action creator
---
# Actions — `createAction` / `createAsyncAction`

> Operational guidance for action creator work. API details and longer examples live in `@augmentcode/themis/docs/REDUCERS.md` → Actions and Async Actions. Public API: `@augmentcode/themis/utils/store/create-action`; related family guidance: `../SKILL.md` §3.

## Use when

- Adding or reusing slice action creators.
- Wiring async request/success/failure flows to reducers or sagas.
- Checking action type ownership during state-integrity work.

## Do

- Search first for the intended action type, creator names, and operation terms; one action type string has one canonical owner.
- Namespace action types as `sliceName/actionName`.
- Use tuple payload typing for positional args, e.g. `createAction<[id: string]>(...)`.
- Use a payload modifier only when callers should pass positional args but reducers/sagas need a shaped payload.
- Pass action creators directly to `takeEvery`/`takeLatest`; their `toString()` exposes the action type.

## Async action cues

- `createAsyncAction<[Args], Success>(asyncType, stagesType)` creates the request creator plus static `.success` and `.failure` creators.
- A dispatched request action carries `payload`, `promise`, and per-instance `success`/`failure` creators.
- Reducers normally handle the request creator, `.success`, and `.failure` to update loading/data/error fields.
- Sagas watch the request creator unless they are intentionally reacting to success/failure events.

## Examples

### No-payload action for explicit events

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";

export const resetTodos = createAction("todos/reset");

const resetAction = resetTodos();
resetAction.payload satisfies undefined;
```

### Tuple payload action consumed by reducers

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

const renameTodo = createAction<[id: string, title: string]>("todos/rename");
const reducer = createReducer({ titles: {} as Record<string, string> }).with(
  renameTodo,
  (state, { payload: [id, title] }) => ({ ...state, titles: { ...state.titles, [id]: title } })
);
```

### Payload modifier when reducers need a named object

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";

export const renameTodo = createAction(
  "todos/rename",
  (id: string, title: string, requestedAtMs: number) => ({ id, title, requestedAtMs })
);

const action = renameTodo("todo-1", "Ship docs", Date.now());
action.payload.id satisfies string;
```

### Async request/success/failure triplet

```ts
import { createAsyncAction } from "@augmentcode/themis/utils/store/create-action";

type Todo = { id: string; title: string };
export const loadTodo = createAsyncAction<[id: string], { id: string }, Todo>(
  "todos/loadAsync",
  "todos/load",
  (id) => ({ id })
);

const request = loadTodo("todo-1");
const success = request.success({ id: "todo-1", title: "Ship docs" });
success.payload.request.id satisfies string;
```

### Watch request creators directly in sagas

```ts
import { takeLatest } from "typed-redux-saga";
import { createAsyncAction } from "@augmentcode/themis/utils/store/create-action";

const loadTodo = createAsyncAction<[id: string], { id: string }>(
  "todos/loadAsync",
  "todos/load",
  (id) => ({ id })
);

function* watchTodos() {
  yield* takeLatest(loadTodo, function* loadTodoWorker(action) {
    action.payload.id satisfies string;
  });
}
```

### ❌ Bad: duplicate owner plus tuple/object payload drift

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";

type RenameTodoPayload = { id: string; title: string };

// BAD: two modules now claim the same action type, and callers get a tuple-wrapped object.
export const renameTodoFromList = createAction<[payload: RenameTodoPayload]>("todos/rename");
export const renameTodoFromDetail = createAction<[payload: RenameTodoPayload]>("todos/rename");

const [{ id, title }] = renameTodoFromList({ id: "todo-1", title: "Ship docs" }).payload;
```

## Don't

- Do not create aliases with the same type string in another module.
- Do not pass `.type` to saga watchers; pass the creator.
- Do not use object payload types for one-argument actions unless an existing public contract already requires that shape.
- Do not place generated timestamps or IDs in reducers; generate them before dispatch.

## Verification cues

- Reducer tests cover each action handler and no-op reference equality.
- Saga tests prove request watchers receive the request creator, not an accidental success/failure creator.
- State-integrity handoff names the canonical owner or states that no new action owner was added.

## See also

- `@augmentcode/themis/docs/REDUCERS.md` — human reference for action and async-action examples.
- `core/reducers/SKILL.md` — consuming actions in `.with()` handlers.
- `core/sagas/SKILL.md` — watcher patterns and typed-redux-saga usage.
- `core/state-integrity/SKILL.md` — duplicate-owner search protocol.
- `core/file-structure/SKILL.md` — where action creators belong.
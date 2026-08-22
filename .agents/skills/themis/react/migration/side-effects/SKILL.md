---
name: react/migration/side-effects
description: >-
  Move shared React side effects to sagas. React sources include useEffect
  subscriptions, fetches, timers, debounces, storage sync, and persistence flows.
type: sub-skill
requires:
  - core/sagas
  - react/migration
triggers:
  - migrate React useEffect
  - React timer to saga
  - React fetch to saga
---
# React side-effect migration

Shared, persistent, or async React side effects move to sagas. DOM-only effectsthat exist solely to manage one component's mounted DOM can remain local.

React sources include `useEffect` fetches, subscriptions, timers, debounces,
storage sync, IPC/websocket listeners, and custom hooks that hide async work.

## Before: component-owned async effect

```tsx
import * as React from "react";
import { useUserContext } from "./UserProvider";

export function UserLoader({ userId }: { userId: string }) {
  const { setUsername } = useUserContext();
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}`).then((res) => res.json()).then((data) => {
      if (!cancelled) setUsername(data.name);
    });
    return () => { cancelled = true; };
  }, [setUsername, userId]);
  return null;
}
```

## After: action-triggered saga

```ts
import { call, put, takeLatest } from "typed-redux-saga";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { setUsername } from "../users-slice";

type UserResponse = { name: string };

export const loadUser = createAction<[userId: string]>("users/loadUser");

function fetchUser(userId: string) {
  return fetch(`/api/users/${userId}`).then((response) => response.json() as Promise<UserResponse>);
}

function* loadUserWorker(action: ReturnType<typeof loadUser>) {
  const user = yield* call(fetchUser, action.payload[0]);
  yield* put(setUsername(user.name));
}

export function* usersSaga() {
  yield* takeLatest(loadUser, loadUserWorker);
}
```

## Start the saga from ReactStore setup

```ts
import { reactStore } from "../react-store";
import { usersSaga } from "./users-saga";

const disposeStore = reactStore.init();
const cancelUsersSaga = reactStore.runSaga(usersSaga);

export function disposeRuntime() {
  cancelUsersSaga();
  disposeStore();
}
```

## Conversion recipes

| React source pattern | Saga target |
| --- | --- |
| useEffect(() => fetch(...), [id]) | Action + takeLatest(action, worker) + call + put |
| Component debounce with setTimeout | Action + takeLatest(action, worker) + delay |
| Reconnect on derived state change | Selector-channel helper from saga code |
| localStorage sync in component/hook | Saga persistence helper called from takeEvery |
| WebSocket/DOM/IPC subscription shared across app | Channel setup in saga with cleanup in finally |
| Async success/failure local state | createAsyncAction flow handled inside saga worker |

## Rules

- Keep reducers pure; never move React effects into reducers.
- Use `takeLatest` for stale-response-prone fetch/search flows.
- Use `takeEvery` when every action must be processed.
- Use selector `.effect(...args)` in sagas when the saga needs current derivedstate.
- Do not keep both a migrated `useEffect` and a saga for the same trigger.
- Do not use selector `.useValue(...args)` or direct React signals from saga code.

## Bad: duplicate ownership

```tsx
// BAD: this duplicates the saga that also persists settingsSaved.
React.useEffect(() => {
  localStorage.setItem("settings", JSON.stringify(settings));
}, [settings]);
```

## Cross-references

- `../../../core/sagas/SKILL.md` — saga patterns and Store-first startup.
- `../../../core/selector-channels/SKILL.md` — reacting to selector value changes from sagas.
- `../../selectors/SKILL.md` — `.effect(...args)` and non-React saga reads.
---
name: svelte/migration/side-effects
description: >-
  Move store subscriptions, $effect blocks, async calls, fetches, timers, and
  IPC listeners into sagas using takeEvery/takeLatest + call/put/delay. Covers
  the fetch/localStorage/$effect to saga conversion and the "side effects in
  reducers" pitfall.
type: sub-skill
requires:
  - core/sagas
  - svelte/migration
triggers:
  - migrate $effect
  - move side effect
  - timer to saga
  - fetch to saga
---
# Migration — `$effect` / `fetch` / Subscriptions → Saga

> Every side effect (localStorage, fetch, event listeners, timers, IPC)currently living inside a component, store, or reducer moves into a saga.Reducers remain pure.

## Examples

### 1. Before: component/store side effects that need saga ownership

```typescript
// migration/components/CounterPersistence.before.ts
declare const count: number;
declare const userId: string;
declare function $effect(effect: () => void): void;
declare function setUsername(name: string): void;

$effect(() => {
  // eslint-disable-next-line no-restricted-globals, no-restricted-syntax -- migration source before safe saga helper conversion
  localStorage.setItem("count", String(count));
});

export async function loadUserFromComponent() {
  const res = await fetch(`/api/users/${userId}`);
  const data = (await res.json()) as { name: string };
  setUsername(data.name);
}
```

### 2. After: user-triggered fetch becomes a `takeLatest` worker

```typescript
// src/lib/store/slices/users/sagas/users-saga.ts
import { call, put, takeLatest } from "typed-redux-saga";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { setUsername } from "../users-slice";

export const loadUser = createAction<[userId: string]>("users/loadUser");

function* loadUserWorker(action: ReturnType<typeof loadUser>) {
  const response = yield* call(fetch, `/api/users/${action.payload[0]}`);
  const data = (yield* call([response, "json"])) as { name: string };
  yield* put(setUsername(data.name));
}

export function* usersSaga() {
  yield* takeLatest(loadUser, loadUserWorker);
}
```

### 3. Timers/debounce migrate to saga cancellation semantics

```typescript
// src/lib/store/slices/search/sagas/search-saga.ts
import type { StoreAction } from "ag-redux-toolkit/types";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { debounceSaga } from "ag-redux-toolkit/saga";
import { queryChanged } from "../search-slice";

export const debounceSearch = createAction<[StoreAction<any>]>("search/debounce");

export function* searchSaga() {
  yield* debounceSaga(debounceSearch, 300);
}

export const debouncedQueryChanged = (query: string) => debounceSearch(queryChanged(query));
```

### 4. Store subscriptions migrate to selector-channel helpers

```typescript
// src/lib/store/slices/session/sagas/session-saga.ts
import { call } from "typed-redux-saga";
import { takeLatestFromSelector } from "ag-redux-toolkit/saga";
import { selectSessionToken } from "../session-selectors";

declare function reconnectWithToken(token: string): Promise<void>;

export function* sessionSaga() {
  yield* takeLatestFromSelector(selectSessionToken, function* ({ payload, prevPayload }) {
    if (payload && payload !== prevPayload) {
      yield* call(reconnectWithToken, payload);
    }
  });
}
```

### 5. Persistence uses safe saga helpers instead of direct browser calls

```typescript
// src/lib/store/slices/settings/sagas/settings-saga.ts
import { call, takeEvery } from "typed-redux-saga";
import { setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { settingsSaved } from "../settings-slice";
import { selectSettings } from "../settings-selectors";

export function* settingsSaga() {
  yield* takeEvery(settingsSaved, function* () {
    const settings = yield* selectSettings.effect();
    yield* call(setLocalStorageJSON, "settings", settings);
  });
}
```

### 6. Async action success/failure flow stays in the worker, not the component

```typescript
// src/lib/store/slices/profile/sagas/profile-saga.ts
import { call, put, takeEvery } from "typed-redux-saga";
import { createAsyncAction } from "ag-redux-toolkit/utils/store/create-action";

type Profile = { id: string; name: string };
declare const api: { saveProfile(profile: Profile): Promise<Profile> };

export const saveProfile = createAsyncAction<[profile: Profile], Profile>(
  "profile/saveProfile",
  "profile/saveProfileStatus"
);

export function* profileSaga() {
  yield* takeEvery(saveProfile, function* (action) {
    try {
      const saved = yield* call(api.saveProfile, action.payload[0]);
      yield* put(action.success(saved));
    } catch (error) {
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    }
  });
}
```

### 7. ❌ Bad: reducer side effect hides cancellation and ordering bugs

```typescript
// ❌ BAD: reducers must not persist, fetch, or read clocks while updating state.
type Settings = { theme: "light" | "dark" };
type SettingsState = { settings: Settings; persistedAt: number | null };

declare const saveSettings: { type: "settings/save" };
declare function reducerWith(action: unknown, handler: (state: SettingsState, action: { payload: [Settings] }) => SettingsState): void;

reducerWith(saveSettings, (state, { payload: [settings] }) => {
  localStorage.setItem("settings", JSON.stringify(settings));
  return { ...state, settings, persistedAt: Date.now() };
});
```

## Conversion Recipes

| Source pattern | Saga equivalent |
| --- | --- |
| $effect(() => { localStorage.setItem(...) }) | takeEvery(action, function* () { yield* call(appLocalSetLocalStorageItem, key, value) }) |
| store.subscribe((v) => ...) that reacts to state | takeEveryFromSelector(selectFoo, args, function* (v) { ... }) (see core/selector-channels) |
| fetch(url).then(r => r.json()).then(setX) | const res = yield* call(fetch, url); const data = yield* call([res, "json"]); yield* put(setX(data)) |
| setTimeout(..., ms) | yield* delay(ms) |
| setInterval(..., ms) | while (true) { yield* delay(ms); ... } (with saga cancellation) |
| window.addEventListener(...) / IPC | createChannelFrom... + redux-saga takeEvery(channel, worker) (see core/channel-effects) |
| onMount(() => { ... }) | Init saga that runs once on slice registration |

## Common Pitfalls

- Do not keep a component `$effect` and add a saga for the same trigger; thatcreates duplicate ownership and double writes.
- Use `takeLatest` for user-triggered fetch/search flows so stale responses arecancelled before they overwrite newer state.
- Close manually-created channels in `finally`; prefer selector-channel helperswhen simple `takeEvery`/`takeLatest`/`takeLeading` semantics are enough.
- Keep reducers pure: no `fetch`, no direct `localStorage`, no clocks, no randomIDs, and no logging side effects.

## Cross-References

- `../../../core/sagas/SKILL.md` — full saga surface (takeEvery /takeLatest / takeLeading, Store-first saga startup, debounceSaga)
- `../../../core/local-storage/SKILL.md` — safe localStoragehelpers and persistence-saga pattern
- `../../../core/channel-effects/SKILL.md` — generic EventChannelconsumers for DOM / IPC / websocket listeners
- `../../../core/selector-channels/SKILL.md` — reacting toselector value changes from sagas
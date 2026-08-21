---
name: react/migration/setup
description: >-
  Pre-migration ReactStore setup. Use the canonical setup skill plus ReactStore
  routing to create the configured store, initialize/dispose it at the React app
  owner, register app reducers, and start app sagas.
type: sub-skill
requires:
  - react
  - react/component-integration
  - react/migration
triggers:
  - ReactStore migration setup
  - bootstrap ReactStore
  - React reducer registry
---
# React migration setup

Complete this once before migrating individual React state owners. Start at thecanonical root setup skill (`../../../setup/SKILL.md`), choose the React Storefamily, and keep the app on `ReactStore` for this code path.

## 1. Import the public ReactStore runtime

Use the npm package directly. Do not copy package source files into the app.

```ts
import { ReactStore } from "@augmentcode/themis/react-store";
import type { StoreState } from "@augmentcode/themis/types";
```

## 2. Create an app-owned ReactStore module

Start with the migrated reducer map you already have, or an empty app-owned mapwhen preparing the runtime before the first slice.

```ts
// src/store/react-store.ts
import { ReactStore } from "@augmentcode/themis/react-store";
import type { StoreState } from "@augmentcode/themis/types";

export const reactStore = new ReactStore({});
export type AppState = StoreState<typeof reactStore>;
```

As slices migrate, add app-owned reducers to the constructor map. Do not manuallyregister package-owned `@internal_` reducers or internal sagas.

## 3. Initialize before rendering selector users

Call `reactStore.init(initialState?)` at the React bootstrap, test harness, or
micro-frontend mount boundary before components call direct selector signals or
`.useValue(...args)` fallbacks.

```tsx
// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { reactStore } from "./store/react-store";

const root = createRoot(document.getElementById("root")!);
const disposeStore = reactStore.init();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

export function disposeApp() {
  root.unmount();
  disposeStore();
}
```

Do not hide `init()` in a child component `useEffect`; effects run after the
first render and can be too late for direct selector signal calls or
`.useValue(...args)` fallbacks.

## 4. Start app sagas explicitly after init

`reactStore.init()` starts package-owned runtime work, not app sagas. Start eachmigrated app saga with `reactStore.runSaga(sagaFn)` after initialization.

```ts
import { reactStore } from "./store/react-store";
import { cartSaga } from "./store/cart/sagas/cart-saga";

const disposeStore = reactStore.init();
const cancelCartSaga = reactStore.runSaga(cartSaga);

export function disposeRuntime() {
  cancelCartSaga();
  disposeStore();
}
```

## 5. Add slices incrementally

Per migrated slice, create app files such as:

- `src/store/{slice}/{slice}-slice.ts` for initial state, actions, reducer.
- `src/store/{slice}/{slice}-selectors.ts` for `reactStore.createSelector(...)`.
- `src/store/{slice}/sagas/{slice}-saga.ts` for async/shared side effects.

Then add the reducer to the `ReactStore` constructor map and start the saga fromthe same runtime owner that initialized the store.

## Verification cues

- `ReactStore` comes from `@augmentcode/themis/react-store`.
- Store initialization happens before React renders selector users.
- App sagas start with `reactStore.runSaga(sagaFn)` after `init()`.
- Setup instructions keep initialization and saga ownership at the React app boundary.
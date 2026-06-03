---
name: svelte/selector-lifecycle
description: >-
  The three selector call modes and Store-first dispatch rule — the #1
  source of runtime crashes in ag-redux-toolkit. Covers selectFoo() at
  component init (Svelte readable via getContext), selectFoo.select(state) for
  one-shot reads in event handlers / callbacks / async, yield* selectFoo.effect()
  inside sagas, and selectFoo.select(state) when composing selectors. Documents
  Store.dispatch usage, the lifecycle_outside_component crash, and
  the wrong-shape trap when passing the selector object to yield* select().
type: sub-skill
requires:
  - svelte
  - svelte/selectors
triggers:
  - selector call mode
  - outside component crash
  - Store dispatch
  - select in handler
---
# Selector Lifecycle — call-mode guardrails

> Operational checklist for avoiding `lifecycle_outside_component`. Human reference and examples: `docs/SELECTORS.md` → Using Selectors and Selector Lifecycle Rules. Source: `../SKILL.md` §4, §7.

## Use when

- Selecting values from components, event handlers, callbacks, tests, sagas, or other selectors.
- Debugging `lifecycle_outside_component` crashes.
- Moving selector reads across component initialization boundaries.

Use this lifecycle only for apps that chose the Svelte Store family. Do not apply
StreamingStore/Kefir selector invocation, observation, setup, or teardown rules in
the same app/package/code path.

## Call-mode map

| Context | Correct call | Why |
| --- | --- | --- |
| Component init/top-level `<script>` | `const value$ = selectFoo(args)` | Uses Svelte context and returns a readable. |
| Template | Use the captured readable as `$value$` | Avoids creating new readables during render. |
| Event handler/callback/async/test | `selectFoo.select(state, args)` | No Svelte context required. |
| Saga | `yield* selectFoo.effect(args)` | Emits the package's typed saga select effect. |
| Selector composition | `otherSelector.select(state, args)` | Reuses state already in scope. |
| Non-context readable | `selectFoo.withStore(store)(args)` | Binds explicitly to a store. |

## Do

- Capture selector readables during component initialization and dispatch through the configured Store instance.
- Use `.select(store.state, ...)` with the existing initialized `Store` instance captured outside the handler for one-shot reads when no state argument is already available.
- Use `.effect()` in sagas instead of passing selector objects to `select`.
- Use `.select(state)` when composing selectors or testing them.

## Don't

- Do not call `selectFoo()` after `await`, inside handlers, inside callbacks, in tests, or inside another selector.
- Do not call `get(selectFoo())` outside component initialization.
- Do not import standalone dispatch helpers; use `store.dispatch(action)` on the configured Store instance.
- Do not pass the selector object itself to saga `select`; use `.effect()` or `.select` intentionally.
- Do not replace Svelte readable lifecycle rules with streaming selector lifecycle
  rules in a Svelte app.

## Examples

### 1. Capture selector readables during component initialization

```ts
import { store as appStore } from "$lib/store";

const item$ = selectItem(itemId);
const canSave$ = selectCanSaveItem(itemId);

function onSave() {
  const item = selectItem.select(appStore.state, itemId);
  if (item) appStore.dispatch(saveItem(item));
}
```

### 2. Derive template-facing values from captured readables

```ts
import { derived } from "svelte/store";

const item$ = selectItem(itemId);
const itemTitle$ = derived(item$, (item) => item?.title ?? "Untitled");
```

### 3. Use .select after await or inside callbacks

```ts
import { store as appStore } from "$lib/store";

async function onArchive(itemId: string) {
  await confirmArchiveDialog(itemId);
  const item = selectItem.select(appStore.state, itemId);
  if (item?.status !== "archived") appStore.dispatch(archiveItem(itemId));
}
```

### 4. Use .effect inside sagas instead of passing selector objects to select

```ts
import { put } from "typed-redux-saga";

function* saveCurrentItemWorker() {
  const itemId = yield* selectCurrentItemId.effect();
  if (itemId) yield* put(saveItem(itemId));
}
```

### 5. Compose selectors with .select(state)

```ts
export const selectVisibleItems = store.createSelector((state) => {
  const items = selectItems.select(state);
  const filter = selectItemFilter.select(state);
  return items.filter((item) => item.status === filter.status);
});
```

### 6. Bind explicitly with .withStore when no Svelte context is available

```ts
import type { Store } from "ag-redux-toolkit/svelte-store";

export function createItemReadable(store: Store, itemId: string) {
  return selectItem.withStore(store)(itemId);
}
```

### 7. ❌ Bad: creating readables after component initialization

```ts
// BAD: selector readable calls after events/await need Svelte context at the wrong time.
async function onSaveLater(itemId: string) {
  await queueMicrotaskPromise();
  const item$ = selectItem(itemId);
  item$.subscribe((item) => store.dispatch(saveItem(item)));
}

async function onSaveLaterSafely(itemId: string) {
  await queueMicrotaskPromise();
  const item = selectItem.select(store.state, itemId);
  if (item) store.dispatch(saveItem(item));
}
```

## Pitfalls

- `selectFoo()` depends on `getContext()`, so create selector readables during component initialization. Dispatch does not need a context helper; use the configured Store instance.
- A selector readable created in a template expression can allocate repeatedly and lose memoization benefits.
- `.select(state)` returns a value; `selectFoo()` returns a readable. Mixing them often produces wrong-shape bugs before it crashes.

## Verification cues

- Component changes show selector readables captured at top-level initialization and Store dispatch used in handlers.
- Tests use `.select(mockState, ...)`, not the readable call form.
- Saga tests cover `.effect()` paths or named selector calls rather than inline `select((state) => ...)` lambdas.

## See also

- `docs/SELECTORS.md` — examples for each selector call form.
- `svelte/selectors/SKILL.md` — selector authoring and composition.
- `svelte/component-integration/SKILL.md` — component store/dispatch wiring.
- `core/selector-channels/SKILL.md` — selector reads from sagas.
- `core/wait-for/SKILL.md` — saga waiting on selector predicates.

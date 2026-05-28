# Selectors and Lifecycle

## 4. Selector Lifecycle Rules ⚠️ CRITICAL

**This is the #1 source of bugs.** Selectors use `getContext()` internally. Using the wrong call mode crashes the app.

| Context                             | Correct Usage                                | Why                                                                        |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Component init (top-level <script>) | const value$ = selectFoo()                   | Returns Svelte readable store. Uses getContext() — only valid during init. |
| Event handlers / callbacks / async  | selectFoo.select(getReduxStore().getState()) | Direct state read. No Svelte context needed.                               |
| Sagas                               | yield\* selectFoo.effect()                   | Uses redux-saga select effect.                                             |
| Composing selectors                 | selectFoo.select(state)                      | Direct call with state argument.                                           |

### ❌ WRONG — crashes with `lifecycle_outside_component`

```typescript
function handleClick() {
  const value = selectFoo(); // CRASHES — getContext() not available
  const model = get(selectModel(id)); // CRASHES — same reason
}
```

### ✅ CORRECT

```typescript
// At component init (top-level script block)
const dispatch = getDispatch(); // ← MUST be at init time
const foo$ = selectFoo(); // ← MUST be at init time

// In event handlers — use .select() for one-time reads
function handleClick() {
  const value = selectFoo.select(getReduxStore().getState());
  dispatch(doSomething(value));
}
```

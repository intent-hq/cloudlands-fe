# waitFor Saga Utility Guide

This project guide is a concise companion to `.agents/skills/ag-redux-toolkit/core/wait-for/SKILL.md`. The skill is the active source of truth for signature, edge cases, and implementation details.

## When to use it

Use `waitFor` when a saga must suspend until a named selector reaches a predicate, then continue once. For continuous reactions to selector changes, use selector-channel helpers instead.

## Current import

```typescript
import { waitFor } from "ag-redux-toolkit/saga";
```

## Project rules

- Pass the selector, an args tuple, a pure predicate, and an optional timeout.
- Use `[]` for selectors with no arguments.
- Add a timeout for production waits unless an indefinite wait is explicitly safe.
- Check the returned boolean when a timeout is provided.
- Guard previous-value predicates against the initial `undefined` value and the first channel emission's nullable previous value.
- Do not pass inline selector functions; create or reuse named Store-bound selectors.
- Do not copy the package channel/race implementation into app code.

## Example

```typescript
import { put } from "typed-redux-saga";
import { waitFor } from "ag-redux-toolkit/saga";

function* loadAfterReady(workspaceId: string) {
  const ready = yield* waitFor(selectWorkspaceReady, [workspaceId], (value) => value === true, 5_000);
  if (!ready) {
    yield* put(workspaceLoadTimedOut(workspaceId));
    return;
  }
  yield* put(loadWorkspaceData(workspaceId));
}
```

## See also

- `.agents/skills/ag-redux-toolkit/core/wait-for/SKILL.md`
- `.agents/skills/ag-redux-toolkit/core/sagas/SKILL.md`
- `.agents/skills/ag-redux-toolkit/svelte/selector-lifecycle/SKILL.md`
- [Selectors Guide](./SELECTORS_GUIDE.md)

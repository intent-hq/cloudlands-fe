# waitFor Saga Utility Guide

## Overview

The `waitFor` saga is a utility function that allows sagas to wait for a specific state value to match an expected condition. It's useful for coordinating async operations that depend on state changes.

**Location**: `src/lib/store/slices/store-utility/sagas/waitFor.ts`

## Purpose

Use `waitFor` when you need to:
- Wait for a state value to reach a specific condition before proceeding
- Coordinate saga execution with state changes
- Implement conditional delays based on state
- Ensure prerequisites are met before executing logic

## Function Signature

```typescript
function* waitFor<ARGS extends any[], R>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  isExpectedValue: (value: R, prevVal: R | undefined | null) => boolean,
  timeoutMs?: number
): Generator<any, boolean, any>
```

### Parameters

- **`selector`**: A `StoreSelector` created with `createSelector()` that extracts the value to monitor
- **`args`**: Arguments to pass to the selector (empty array `[]` if selector takes no arguments)
- **`isExpectedValue`**: Callback function that receives the current value and previous value, returns `true` when the expected condition is met
- **`timeoutMs`** (optional): Maximum time to wait in milliseconds before returning

### Return Value

Returns `true` when the expected value is observed. If `timeoutMs` is provided and the timeout wins the race first, it returns `false`.

## How It Works

1. **Immediate Check**: First checks if the current state value already matches the expected condition
2. **Channel Subscription**: If not matched, creates a channel to listen for state changes
3. **Value Monitoring**: Continuously checks each state change until the condition is met
4. **Timeout Handling**: If `timeoutMs` is provided, races between value match and timeout
5. **Cleanup**: Always closes the channel in a `finally` block

## Usage Examples

### Basic Usage - Wait for Boolean Flag

```typescript
import { waitFor } from "../../store-utility/sagas/waitFor";
import { selectIsSummarizing } from "../selectors";

function* mySaga(conversationId: string, exchange: ExchangeWithStatus) {
  // Wait for summarization to complete
  yield* waitFor(
    selectIsSummarizing,
    [conversationId],
    (isSummarizing) => isSummarizing === false
  );

  // Continue after summarization is done
  yield* put(submitUserExchange(conversationId, exchange));
}
```

### With Timeout

```typescript
function* mySagaWithTimeout() {
  // Wait up to 5 seconds for the value
  yield* waitFor(
    selectIsReady,
    [],
    (isReady) => isReady === true,
    5000 // 5 second timeout
  );

  // Continues after match or timeout
}
```

### Using Previous Value

```typescript
function* detectChange() {
  // Wait for value to change from its current state
  yield* waitFor(
    selectStatus,
    [],
    (value, prevVal) => {
      // Only match if value actually changed
      return prevVal !== undefined && value !== prevVal;
    }
  );
}
```

### Complex Condition

```typescript
function* waitForSpecificState() {
  yield* waitFor(
    selectConversationTurnStatus,
    [conversationId],
    (status) => status === AgentExchangeStatus.notRunning
  );
}
```

### With Selector Arguments

```typescript
function* waitForToolCompletion(toolId: string) {
  yield* waitFor(
    selectToolPhase,
    [toolId],
    (phase) => phase === ToolUsePhase.completed || phase === ToolUsePhase.error
  );
}
```

## Best Practices

### ✅ DO

- **Use named selectors**: Always create selectors in `*-selectors.ts` files
- **Keep conditions simple**: Make `isExpectedValue` callbacks straightforward
- **Add timeouts for safety**: Use `timeoutMs` to prevent infinite waiting
- **Check the boolean result**: With `timeoutMs`, `true` means the condition matched and `false` means the timeout fired first
- **Use for coordination**: Great for ensuring prerequisites before executing logic

### ❌ DON'T

- **Don't use inline selectors**: Never pass inline selector functions
- **Don't perform side effects**: Keep `isExpectedValue` pure (no API calls, no mutations)
- **Don't wait indefinitely**: Always consider adding a timeout for production code
- **Don't ignore the return value**: If you pass `timeoutMs`, handle the `false` timeout case explicitly
- **Don't use for polling**: Use channels or other patterns for continuous monitoring

## Real-World Examples

### Example 1: Timeout Handling in the Utility

<augment_code_snippet path="src/lib/store/slices/store-utility/sagas/waitFor.ts" mode="EXCERPT">
````typescript
const { value } = yield* race({
  value: callEffect,
  timeout: delay(timeoutMs),
});
return value || false;
````
</augment_code_snippet>

### Example 2: Selector Arguments in Tests

<augment_code_snippet path="src/lib/store/slices/store-utility/sagas/waitFor.test.ts" mode="EXCERPT">
````typescript
await expectSaga(waitFor, selector, ["test-id"], isExpectedValue)
  .provide([[matchers.getContext("readableStoreState"), storeState]])
  .withReducer(createTestReducer(store.getState()))
  .returns(true)
  .silentRun(100);
````
</augment_code_snippet>

## Known Issues and Limitations

### ⚠️ Issue 1: No Cancellation Support

**Problem**: Once `waitFor` starts, it cannot be cancelled externally (except by cancelling the parent saga).

**Impact**: Long-running waits cannot be interrupted gracefully.

**Workaround**: Use shorter timeouts or implement custom cancellation logic in parent saga.

### ⚠️ Issue 2: Selector Errors Propagate

**Problem**: If `selector.effect()` throws before the channel is created, the error propagates immediately to the caller.

**Impact**: Callers need to handle selector errors explicitly when using `waitFor`.

**Workaround**: Wrap the `waitFor` call in a parent `try/catch` when working with selectors that may throw.

## Testing

See `src/lib/store/slices/store-utility/sagas/waitFor.test.ts` for comprehensive test examples covering:
- Immediate value matches
- Waiting for value changes
- Timeout behavior
- Channel cleanup
- Previous value tracking
- Edge cases (rapid changes, errors)

## Related Utilities

- **`lockUpdates` / `unlockUpdates`**: Actions from `src/lib/store/slices/store-utility/store-utility-slice.ts` that pause and resume selector updates
- **`createSelector`**: Creates selectors with `.effect()` and `.select()` methods
- **Selector channel effects**: `takeLatestFromSelector`, `takeEveryFromSelector`, `takeLeadingFromSelector` for watching selector changes
- **`createChannelFromSelector`**: Creates event channels from selectors for complex patterns
- **`delay`**: Simple time-based delays without state monitoring

---

**Last Updated**: 2026-03-17

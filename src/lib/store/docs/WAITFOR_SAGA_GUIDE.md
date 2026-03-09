# waitFor Saga Utility Guide

## Overview

The `waitFor` saga is a utility function that allows sagas to wait for a specific state value to match an expected condition. It's useful for coordinating async operations that depend on state changes.

**Location**: `clients/common/webviews/src/apps/chat/redux/store/store-utility/sagas/waitFor.ts`

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

Always returns `true` (see Known Issues below)

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
- **Handle both success and timeout**: Remember that `waitFor` returns `true` in both cases
- **Use for coordination**: Great for ensuring prerequisites before executing logic

### ❌ DON'T

- **Don't use inline selectors**: Never pass inline selector functions
- **Don't perform side effects**: Keep `isExpectedValue` pure (no API calls, no mutations)
- **Don't wait indefinitely**: Always consider adding a timeout for production code
- **Don't assume success**: Check state after `waitFor` returns if timeout was used
- **Don't use for polling**: Use channels or other patterns for continuous monitoring

## Real-World Examples

### Example 1: Wait for Summarization Before Sending

<augment_code_snippet path="clients/common/webviews/src/apps/chat/redux/store/conversations/saga/send-exchange.ts" mode="EXCERPT">
````typescript
// Wait until summarization is done for this conversation
yield* waitFor(selectIsSummarizing, [conversationId], (isSummarizing) => isSummarizing === false);
````
</augment_code_snippet>

### Example 2: Delayed Action After Status Change

<augment_code_snippet path="clients/common/webviews/src/apps/chat/redux/store/conversation-history/sagas/history-summarization.ts" mode="EXCERPT">
````typescript
const addSummarizationNodeSagaDelayed = function* () {
  const maybeSummarizeAfterMs = params.cacheTTLMs - responseDurationMs - params.bufferTimeBeforeCacheExpirationMs;
  yield* delay(maybeSummarizeAfterMs);
  yield* waitFor(selectConversationTurnStatus, [conversationId], (status) => status === AgentExchangeStatus.notRunning);
  yield* put(addSummarizationNode(conversationId));
};
````
</augment_code_snippet>

## Known Issues and Limitations

### ⚠️ Issue 1: Always Returns True

**Problem**: `waitFor` always returns `true`, even when it times out. This makes it impossible to distinguish between successful match and timeout.

**Impact**: Callers cannot determine if the expected condition was met or if the timeout occurred.

**Workaround**: After `waitFor` returns, manually check the state again:

```typescript
yield* waitFor(selector, args, isExpectedValue, timeoutMs);

// Check if condition was actually met
const currentValue = yield* selector.effect(...args);
if (!isExpectedValue(currentValue, null)) {
  // Handle timeout case
  console.warn("waitFor timed out");
}
```

**Recommendation**: Consider returning the race result to distinguish timeout from success.

### ⚠️ Issue 2: No Cancellation Support

**Problem**: Once `waitFor` starts, it cannot be cancelled externally (except by cancelling the parent saga).

**Impact**: Long-running waits cannot be interrupted gracefully.

**Workaround**: Use shorter timeouts or implement custom cancellation logic in parent saga.

### ⚠️ Issue 3: Channel Not Closed on Error

**Problem**: If `selector.effect()` throws an error before the channel is created, the error propagates without cleanup issues. However, if the selector throws during channel monitoring, the channel is properly closed due to the `finally` block.

**Impact**: Minimal - the `finally` block ensures cleanup in most cases.

## Testing

See `waitFor.test.ts` for comprehensive test examples covering:
- Immediate value matches
- Waiting for value changes
- Timeout behavior
- Channel cleanup
- Previous value tracking
- Edge cases (rapid changes, errors)

## Related Utilities

- **`lockReactiveSelectors`**: Temporarily prevents selector updates during batch operations
- **`createSelector`**: Creates selectors with `.effect()` and `.select()` methods
- **Selector channel effects**: `takeLatestFromSelector`, `takeEveryFromSelector`, `takeLeadingFromSelector` for watching selector changes
- **`createChannelFromSelector`**: Creates event channels from selectors for complex patterns
- **`delay`**: Simple time-based delays without state monitoring

---

**Last Updated**: 2026-02-03

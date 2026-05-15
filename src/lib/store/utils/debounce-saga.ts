import { type Task } from "redux-saga";
import {
  cancel,
  delay,
  fork,
  put,
  take,
  type SagaGenerator,
} from "typed-redux-saga";
import type { StoreAction, StoreActionCreator } from "../types";

/**
 * Creates a debouncing saga that can handle multiple different actions.
 *
 * This saga takes an action that wraps another action as its payload,
 * and debounces the inner action. It maintains separate debounce timers
 * for each unique action type, so different actions can be debounced
 * independently.
 *
 * @example
 * ```typescript
 * // Define a wrapper action
 * const debounceAction = createAction<[StoreAction<any>]>("debounceAction");
 *
 * // In your saga
 * export function* mySaga() {
 *   yield* debounceSaga(debounceAction, 300);
 * }
 *
 * // Usage: dispatch the wrapper action with the actual action as payload
 * dispatch(debounceAction(someAction("data")));
 * dispatch(debounceAction(anotherAction(123)));
 * ```
 *
 * @param wrapperActionCreator - The action creator that wraps other actions
 * @param debounceMs - Debounce delay in milliseconds
 */
export function* debounceSaga<AC extends StoreActionCreator<[StoreAction<any>]>>(
  wrapperActionCreator: AC,
  debounceMs: number
): SagaGenerator<void> {
  yield* debounceWithKeySaga(wrapperActionCreator, debounceMs, (action) => action.type);
}

/**
 * Creates a debouncing saga with a custom key extractor.
 *
 * This allows you to debounce based on custom logic, not just action type.
 * For example, you might want to debounce per user ID, per conversation ID, etc.
 *
 * @example
 * ```typescript
 * // Debounce per conversation ID
 * yield* debounceWithKeySaga(
 *   debounceAction,
 *   300,
 *   (action) => action.payload[0]
 * );
 * ```
 *
 * @param wrapperActionCreator - The action creator that wraps other actions
 * @param debounceMs - Debounce delay in milliseconds
 * @param keyExtractor - Function to extract a unique key from the inner action
 */
export function* debounceWithKeySaga<AC extends StoreActionCreator<[StoreAction<any>]>>(
  wrapperActionCreator: AC,
  debounceMs: number,
  keyExtractor: (action: StoreAction<any>) => string
): SagaGenerator<void> {
  // Map to track running debounce tasks for each key
  const debounceTasks = new Map<string, Task>();

  while (true) {
    // Wait for the wrapper action
    const wrapperAction = yield* take(wrapperActionCreator);

    // Extract the inner action from the payload
    const [innerAction] = wrapperAction.payload;

    // Get the debounce key using the custom extractor
    const debounceKey = keyExtractor(innerAction);

    // Cancel any existing debounce task for this key
    const existingTask = debounceTasks.get(debounceKey);
    if (existingTask) {
      yield* cancel(existingTask);
    }

    // Fork a new debounce task
    const newTask: Task = yield* fork(function* () {
      yield* delay(debounceMs);

      // After the debounce delay, dispatch the inner action
      yield* put(innerAction);

      // Clean up the task from the map
      debounceTasks.delete(debounceKey);
    });

    // Store the new task
    debounceTasks.set(debounceKey, newTask);
  }
}

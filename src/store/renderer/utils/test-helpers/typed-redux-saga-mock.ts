/**
 * Shared mock for `typed-redux-saga` used in saga tests.
 *
 * typed-redux-saga wraps redux-saga effects as generator functions that return
 * typed `SagaGenerator` values. In tests we need to convert them back to plain
 * redux-saga effects so that helpers like `expectSaga` / `testSaga` / `runSaga`
 * can interpret them.
 *
 * Usage in test files:
 * ```ts
 * vi.mock("typed-redux-saga", async () => await import("../relative/path/to/typed-redux-saga-mock"));
 * ```
 */

import * as sagaEffects from "redux-saga/effects";

// Re-export SagaGenerator type so tests that import it from "typed-redux-saga" still work.
export type { SagaGenerator } from "typed-redux-saga";

export function* call(fnOrDescriptor: any, ...args: any[]): Generator<any, any, any> {
  return yield Array.isArray(fnOrDescriptor)
    ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
    : sagaEffects.call(fnOrDescriptor, ...args);
}

export function* put(action: any): Generator<any, any, any> {
  return yield sagaEffects.put(action);
}

export function* select(selector: any, ...args: any[]): Generator<any, any, any> {
  return yield sagaEffects.select(selector, ...args);
}

export function* fork(fn: any, ...args: any[]): Generator<any, any, any> {
  return yield sagaEffects.fork(fn, ...args);
}

export function* delay(ms: number): Generator<any, any, any> {
  return yield sagaEffects.delay(ms);
}

export function* take(patternOrChannel: any): Generator<any, any, any> {
  return yield sagaEffects.take(patternOrChannel);
}

export function* takeLatest(pattern: any, worker: any): Generator<any, any, any> {
  return yield sagaEffects.takeLatest(pattern, worker);
}

export function* takeEvery(pattern: any, worker: any): Generator<any, any, any> {
  return yield sagaEffects.takeEvery(pattern, worker);
}

export function* join(task: any): Generator<any, any, any> {
  return yield sagaEffects.join(task);
}

export function* race(obj: any): Generator<any, any, any> {
  return yield sagaEffects.race(obj);
}

export function* cancel(...tasks: any[]): Generator<any, any, any> {
  return yield sagaEffects.cancel(...(tasks as [any]));
}


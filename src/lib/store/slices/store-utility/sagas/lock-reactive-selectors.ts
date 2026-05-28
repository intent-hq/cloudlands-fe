import {
  call,
  put,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  lockUpdates,
  unlockUpdates,
} from "../store-utility-slice";
import { selectUpdatesLocked } from "../store-utility-selectors";

/*
  Locks readable or channel selectors from emiting updates.
  This is useful for rapid store updates
*/
export function* lockReactiveSelectors(handler: () => SagaGenerator<any, any>) {
  const isLocked = yield* selectUpdatesLocked.effect();
  if (isLocked) {
    // don't lock if it is already locked. This reduces redundant action dispatches
    yield* call(handler);
    return;
  }
  try {
    yield* put(lockUpdates());
    yield* call(handler);
  } catch (e) {
    console.error(e);
    throw e;
  } finally {
    yield* put(unlockUpdates());
  }
}

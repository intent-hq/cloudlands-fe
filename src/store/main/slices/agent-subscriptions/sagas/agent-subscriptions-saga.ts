/**
 * Crash-recovery wrappers for agent-subscriptions sagas.
 *
 * Main-process startup registers static zero-argument child sagas directly in
 * the main saga registry. Runtime worker forks remain inside their owning sagas.
 */

import { call, delay } from "typed-redux-saga";
import { delegationGroupSaga } from "./delegation-group-saga";
import { matchingSaga } from "./matching-saga";
import { Logger } from "../../../../../shared/logger";

const logger = new Logger("AgentSubscriptionsSaga");

export function* supervisedDelegationGroupSaga() {
  while (true) {
    try {
      yield* call(delegationGroupSaga);
      logger.warn("Delegation group saga exited unexpectedly, restarting in 1s");
    } catch (error) {
      logger.error("Delegation group saga crashed, restarting in 1s", { error });
    }
    yield* delay(1000);
  }
}

export function* supervisedMatchingSaga() {
  while (true) {
    try {
      yield* call(matchingSaga);
      // matchingSaga uses takeEvery and should never return normally.
      // If it does, log and delay before restarting.
      logger.warn("Matching saga exited unexpectedly, restarting in 1s");
    } catch (error) {
      logger.error("Matching saga crashed, restarting in 1s", { error });
    }
    yield* delay(1000);
  }
}


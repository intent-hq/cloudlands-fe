/**
 * Root saga for the agent-subscriptions slice.
 *
 * Forks all sub-sagas (delivery, delegation group, cleanup, IPC bridge, matching)
 * so they run concurrently.
 */

import { call, delay, fork, spawn } from "typed-redux-saga";
import { deliverySaga } from "./delivery-saga";
import { delegationGroupSaga } from "./delegation-group-saga";
import { cleanupSaga } from "./cleanup-saga";
import { ipcBridgeSaga } from "./ipc-bridge-saga";
import { matchingSaga } from "./matching-saga";
import { Logger } from "../../../../../shared/logger";

const logger = new Logger("AgentSubscriptionsSaga");

export function* agentSubscriptionsSaga() {
  yield* fork(deliverySaga);
  yield* fork(delegationGroupSaga);
  yield* fork(cleanupSaga);
  yield* fork(ipcBridgeSaga);
  yield* spawn(function* () {
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
  });
}


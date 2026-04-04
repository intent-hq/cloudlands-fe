/**
 * Root saga for the agent-subscriptions slice.
 *
 * Forks all sub-sagas (delivery, delegation group, persistence, cleanup)
 * so they run concurrently.
 */

import { fork } from "typed-redux-saga";
import { deliverySaga } from "./delivery-saga";
import { delegationGroupSaga } from "./delegation-group-saga";
import { persistenceSaga } from "./persistence-saga";
import { cleanupSaga } from "./cleanup-saga";
import { ipcBridgeSaga } from "./ipc-bridge-saga";
import { matchingSaga } from "./matching-saga";

export function* agentSubscriptionsSaga() {
  yield* fork(deliverySaga);
  yield* fork(delegationGroupSaga);
  yield* fork(persistenceSaga);
  yield* fork(cleanupSaga);
  yield* fork(ipcBridgeSaga);
  yield* fork(matchingSaga);
}


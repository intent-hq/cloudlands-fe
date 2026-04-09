/**
 * Root saga for the agent-subscriptions slice.
 *
 * Forks all sub-sagas (delivery, delegation group, cleanup, IPC bridge, matching)
 * so they run concurrently.
 */

import { fork } from "typed-redux-saga";
import { deliverySaga } from "./delivery-saga";
import { delegationGroupSaga } from "./delegation-group-saga";
import { cleanupSaga } from "./cleanup-saga";
import { ipcBridgeSaga } from "./ipc-bridge-saga";
import { matchingSaga } from "./matching-saga";

export function* agentSubscriptionsSaga() {
  yield* fork(deliverySaga);
  yield* fork(delegationGroupSaga);
  yield* fork(cleanupSaga);
  yield* fork(ipcBridgeSaga);
  yield* fork(matchingSaga);
}


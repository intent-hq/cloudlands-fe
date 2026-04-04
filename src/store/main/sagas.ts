/**
 * Main-process root saga.
 *
 * Forks all feature-level sagas for the main process store.
 */

import { fork } from "typed-redux-saga";
import { agentSubscriptionsSaga } from "./slices/agent-subscriptions/sagas/agent-subscriptions-saga";
import { workspaceEventsSaga } from "./slices/workspace-events/sagas/workspace-events-saga";
import { workspaceLifecycleEventsSaga } from "./slices/workspace-lifecycle-events/sagas/workspace-lifecycle-events-saga";
import { noteEventsSaga } from "./slices/note-events/sagas/note-events-saga";
import { agentEventsSaga } from "./slices/agent-events/sagas/agent-events-saga";
import { gitEventsSaga } from "./slices/git-events/sagas/git-events-saga";
import { terminalEventsSaga } from "./slices/terminal-events/sagas/terminal-events-saga";
import { scriptEventsSaga } from "./slices/script-events/sagas/script-events-saga";
import { appEventsSaga } from "./slices/app-events/sagas/app-events-saga";
import { sourceEventsSaga } from "./slices/source-events/sagas/source-events-saga";
import { messageAccumulatorSaga } from "./slices/message-accumulator/sagas/message-accumulator-saga";

export function* mainRootSaga() {
  yield* fork(agentSubscriptionsSaga);
  yield* fork(workspaceEventsSaga);
  yield* fork(messageAccumulatorSaga);

  // Domain event slices (broadcast + listeners)
  yield* fork(workspaceLifecycleEventsSaga);
  yield* fork(noteEventsSaga);
  yield* fork(agentEventsSaga);
  yield* fork(gitEventsSaga);
  yield* fork(terminalEventsSaga);
  yield* fork(scriptEventsSaga);
  yield* fork(appEventsSaga);
  yield* fork(sourceEventsSaga);
}
/**
 * Main-process saga registry.
 *
 * This registry is the startup source of truth for static zero-argument main
 * sagas. initMainStore starts each entry independently so a crash in one saga
 * does not cancel sibling sagas; there is intentionally no aggregate root saga
 * wrapping these static startup entries.
 *
 * Dynamic/runtime-argument worker forks remain internal to the sagas that own
 * them and should not be listed here as startup entries.
 */

import type { Saga } from "redux-saga";

import type { MainStore } from "./types";
import {
  deliverySaga,
  periodicQueueSweep,
  watchAgentIdleForDelivery,
} from "./slices/agent-subscriptions/sagas/delivery-saga";
import {
  cleanupSaga,
  watchAgentDeletion,
} from "./slices/agent-subscriptions/sagas/cleanup-saga";
import {
  delegationGroupSaga,
  watchDelegationAgentCompleted,
  watchDelegationAgentDeleted,
} from "./slices/agent-subscriptions/sagas/delegation-group-saga";
import { ipcBridgeSaga } from "./slices/agent-subscriptions/sagas/ipc-bridge-saga";
import { matchingSaga } from "./slices/agent-subscriptions/sagas/matching-saga";
import { subscriptionsChangedEmitterSaga } from "./slices/agent-subscriptions/sagas/subscriptions-changed-emitter-saga";
import { workspaceEventsSaga } from "./slices/workspace-events/sagas/workspace-events-saga";
import { workspaceEventsPersistenceSaga } from "./slices/workspace-events/sagas/persistence-saga";
import { workspaceEventsBroadcastSaga } from "./slices/workspace-events/sagas/broadcast-saga";
import { workspaceTasksChangedSaga } from "./slices/workspace-events/sagas/tasks-changed-saga";
import { rendererSubscriptionSaga } from "./slices/workspace-events/sagas/renderer-subscription-saga";
import { eventTriggeredSagas } from "./slices/workspace-events/sagas/event-triggered-sagas";
import { workspaceLifecycleEventsSaga } from "./slices/workspace-lifecycle-events/sagas/workspace-lifecycle-events-saga";
import { noteEventsSaga } from "./slices/note-events/sagas/note-events-saga";
import { agentEventsSaga } from "./slices/agent-events/sagas/agent-events-saga";
import { gitEventsSaga } from "./slices/git-events/sagas/git-events-saga";
import { terminalEventsSaga } from "./slices/terminal-events/sagas/terminal-events-saga";
import { scriptEventsSaga } from "./slices/script-events/sagas/script-events-saga";
import { appEventsSaga } from "./slices/app-events/sagas/app-events-saga";
import { sourceEventsSaga } from "./slices/source-events/sagas/source-events-saga";
import { staleCleanupLoop } from "./slices/message-accumulator/sagas/message-accumulator-saga";
import { tokenUsageSaga } from "./slices/token-usage/sagas/token-usage-saga";

export type MainSaga = () => ReturnType<Saga>;

export const mainSagas = {
  deliverySaga,
  watchAgentIdleForDelivery,
  periodicQueueSweep,
  delegationGroupSaga,
  watchDelegationAgentCompleted,
  watchDelegationAgentDeleted,
  cleanupSaga,
  watchAgentDeletion,
  ipcBridgeSaga,
  subscriptionsChangedEmitterSaga,
  matchingSaga,

  workspaceEventsSaga,
  workspaceEventsPersistenceSaga,
  workspaceEventsBroadcastSaga,
  workspaceTasksChangedSaga,
  rendererSubscriptionSaga,
  eventTriggeredSagas,

  staleCleanupLoop,

  tokenUsageSaga,

  workspaceLifecycleEventsSaga,
  noteEventsSaga,
  agentEventsSaga,
  gitEventsSaga,
  terminalEventsSaga,
  scriptEventsSaga,
  appEventsSaga,
  sourceEventsSaga,
} satisfies Record<string, MainSaga>;

export type MainSagaName = keyof typeof mainSagas;

export const mainSagaNames = Object.keys(mainSagas) as MainSagaName[];

export const mainSagaEntries = mainSagaNames.map((name) => ({
  name,
  saga: mainSagas[name],
}));

export function startAllMainSagas(
  store: MainStore,
): Array<() => void> {
  return mainSagaEntries.map(({ saga }) => store.runSaga(saga));
}

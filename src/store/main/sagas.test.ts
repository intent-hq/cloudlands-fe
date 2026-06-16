import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  mainSagaEntries,
  mainSagaNames,
  mainSagas,
} from "./sagas";
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

const SAGAS_SOURCE = readFileSync(join(process.cwd(), "src/store/main/sagas.ts"), "utf-8");

const expectedSagas = {
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
} as const;

describe("main saga registry", () => {
  it("lists every static zero-argument main saga with a stable name", () => {
    expect(mainSagas).toEqual(expectedSagas);
    expect(mainSagaNames).toEqual(Object.keys(expectedSagas));
    expect(mainSagaEntries).toEqual(
      mainSagaNames.map((name) => ({ name, saga: expectedSagas[name] })),
    );
  });

  it("does not reintroduce a broad static main root fork tree", () => {
    expect(mainSagas).not.toHaveProperty("mainRootSaga");
    expect(mainSagas).not.toHaveProperty("supervisedDelegationGroupSaga");
    expect(mainSagas).not.toHaveProperty("supervisedMatchingSaga");
    expect(SAGAS_SOURCE).not.toMatch(/function\*\s+mainRootSaga/);
    expect(SAGAS_SOURCE).not.toContain("yield* fork(");
    expect(SAGAS_SOURCE).not.toContain("supervisedDelegationGroupSaga");
    expect(SAGAS_SOURCE).not.toContain("supervisedMatchingSaga");
  });
});

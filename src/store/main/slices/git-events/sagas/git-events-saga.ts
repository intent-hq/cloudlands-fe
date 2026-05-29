/**
 * Git Events Saga
 *
 * Broadcast + listener sagas for git domain events.
 */

import {
  call,
  takeEvery,
} from "typed-redux-saga";
import type { StoreAction } from "svelte-redux-toolkit/types";
import type { DomainEvent } from "../../../../../features/events/types";
import {
  broadcastDomainEvent,
  broadcastDomainEventToStdio,
} from "../../../utils/domain-event-broadcast";
import {
  gitCommitCreated,
  gitStatusChanged,
  GIT_EVENT_TYPES,
  GIT_EVENT_ACTION_MAP,
} from "../git-events-slice";

// ---------------------------------------------------------------------------
// Reverse map: action type → IPC channel
// ---------------------------------------------------------------------------

const ACTION_TYPE_TO_IPC: Record<string, DomainEvent> = {};
for (const [domainEvent, entry] of Object.entries(GIT_EVENT_ACTION_MAP)) {
  if (entry) ACTION_TYPE_TO_IPC[entry.actionCreator.type] = domainEvent as DomainEvent;
}

// ---------------------------------------------------------------------------
// Broadcast handler
// ---------------------------------------------------------------------------

function* handleBroadcast(action: StoreAction<[unknown]>) {
  const ipcChannel = ACTION_TYPE_TO_IPC[action.type];
  if (!ipcChannel) return;

  const [data] = action.payload;
  yield* call(broadcastDomainEvent, ipcChannel, data, false);
  yield* call(broadcastDomainEventToStdio, ipcChannel, data);
}

// ---------------------------------------------------------------------------
// Listener: git:status-changed → workspace service
// ---------------------------------------------------------------------------

function* handleGitStatusChangedForService(
  action: ReturnType<typeof gitStatusChanged>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { workspaceService } = await import(
      "../../../../../features/workspace/main/workspace.service"
    );
    workspaceService.onGitStatusChanged(data);
  });
}

// ---------------------------------------------------------------------------
// Listener: git:commit-created → file tracking
// ---------------------------------------------------------------------------

function* handleGitCommitCreatedForFileTracking(
  action: ReturnType<typeof gitCommitCreated>,
) {
  const [data] = action.payload;
  yield* call(async () => {
    const { Logger } = await import("../../../../../shared/logger");
    const logger = new Logger("GitEventsSaga");
    const { workspaceId, commitSha, postCommitHandled } = data;

    if (postCommitHandled) {
      logger.debug('Skipping post-commit handling - already done by caller', { workspaceId });
      return;
    }

    if (!global.gitIntegrations) {
      global.gitIntegrations = new Map();
    }

    const gitIntegration = global.gitIntegrations.get(workspaceId);
    if (gitIntegration) {
      await gitIntegration.handlePostCommit(commitSha);
      await gitIntegration.syncCurrentState(true);
      logger.info('Post-commit transition complete via saga', { workspaceId });
    } else {
      logger.warn('No git integration found for workspace', { workspaceId });
    }
  });
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* gitEventsSaga() {
  // Broadcast all git events
  yield* takeEvery(GIT_EVENT_TYPES, handleBroadcast);

  // Workspace service reactions
  yield* takeEvery(gitStatusChanged, handleGitStatusChangedForService);
  yield* takeEvery(gitCommitCreated, handleGitCommitCreatedForFileTracking);
}


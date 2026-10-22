import { buffers } from 'redux-saga';
import { actionChannel, call, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$shared/generated/ipc-client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { CommandResponse } from '$shared/types';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectSettingsWorkspaceIds } from '../workspace-settings-selectors';
import {
  clearWorkspaceSettings,
  loadAutoCommitSettings,
  refreshAutoCommitSettings,
  setAutoCommitEnabled,
  syncWorkspaceSettings,
} from '../workspace-settings-slice';

const logger = createLogger('WorkspaceSettingsPersistenceSaga');
type AutoCommitAction = ReturnType<typeof setAutoCommitEnabled>;
type SettingsAction = ReturnType<
  | typeof setAutoCommitEnabled
  | typeof syncWorkspaceSettings
  | typeof workspaceMounted
  | typeof refreshAutoCommitSettings
  | typeof clearWorkspaceSettings
>;

/**
 * Persists the per-workspace auto-commit override only. This must never write
 * the legacy `settings:set { key: 'autoCommit' }` channel — that channel maps
 * to the daemon's GLOBAL `git.autoCommit` setting, so writing it here would
 * flip the global default every time a single workspace's toggle changes.
 *
 * The channel resolves a `CommandResponse` envelope in both builds (Electron
 * main handler and the web-build daemon bridge), so a persistence failure
 * arrives as `{ success: false }` rather than a rejection — treat it the same.
 */
function* persistWorkspaceAutoCommitWorker(action: AutoCommitAction): SagaGenerator<void> {
  const [workspaceId, autoCommitEnabled] = action.payload;

  try {
    const response = (yield* call(invoke, WORKSPACE_CHANNELS.UPDATE_SETTINGS, {
      id: workspaceId,
      settings: { autoCommitEnabled },
    })) as CommandResponse;
    if (!response?.success) {
      logger.warn('Failed to sync autoCommit to main process', {
        workspaceId,
        autoCommitEnabled,
        error: response?.error,
      });
    }
  } catch (error) {
    logger.warn('Failed to sync autoCommit to main process', {
      workspaceId,
      autoCommitEnabled,
      error,
    });
  }
}

// Runtime queue metadata, never Redux state. Reads and writes share one owner
// because a read started during an unacknowledged write can revert the toggle.
type WorkspaceRequests = {
  revision: number;
  write?: AutoCommitAction;
  read: boolean;
  running: boolean;
  cleared: boolean;
};

function* consumeWorkspaceRequests(
  workspaceId: string,
  pending: WorkspaceRequests,
  requests: Map<string, WorkspaceRequests>,
): SagaGenerator<void> {
  try {
    while (pending.write || pending.read) {
      if (pending.write) {
        const action = pending.write;
        pending.write = undefined;
        yield* call(persistWorkspaceAutoCommitWorker, action);
        continue;
      }
      pending.read = false;
      const revision = pending.revision;
      try {
        const settings = yield* call(
          [appClient.settings, appClient.settings.getWorkspaceSettings],
          workspaceId,
        );
        if (pending.revision !== revision) continue;
        if (!settings) {
          logger.warn('workspace.getAutoCommit returned no value; keeping current toggle state', {
            workspaceId,
          });
        } else {
          yield* put(loadAutoCommitSettings(workspaceId, settings.autoCommitEnabled));
        }
      } catch (error) {
        if (pending.revision === revision) {
          logger.warn('Failed to hydrate auto-commit settings from daemon', { workspaceId, error });
        }
      }
    }
  } finally {
    pending.running = false;
    requests.delete(workspaceId);
  }
}

/** Serial per workspace; coalesce trailing reads/writes without cancelling wire mutations. */
export function* workspaceSettingsSaga(): SagaGenerator<void> {
  const requests = new Map<string, WorkspaceRequests>();
  const actions = yield* actionChannel(
    [
      setAutoCommitEnabled,
      syncWorkspaceSettings,
      workspaceMounted,
      refreshAutoCommitSettings,
      clearWorkspaceSettings,
    ],
    buffers.expanding(),
  );
  try {
    while (true) {
      const action = (yield* take(actions)) as SettingsAction;
      const workspaceIds =
        action.type === refreshAutoCommitSettings.type
          ? [
              ...new Set([
                ...(yield* selectSettingsWorkspaceIds.effect()),
                ...[...requests].filter(([, pending]) => !pending.cleared).map(([id]) => id),
              ]),
            ]
          : [action.payload?.[0]];
      for (const workspaceId of workspaceIds) {
        if (!workspaceId) continue;
        let pending = requests.get(workspaceId);
        if (!pending) {
          if (action.type === clearWorkspaceSettings.type) continue;
          pending = { revision: 0, read: false, running: false, cleared: false };
          requests.set(workspaceId, pending);
        }
        pending.revision++;
        if (action.type === clearWorkspaceSettings.type) {
          pending.write = undefined;
          pending.read = false;
          pending.cleared = true;
          continue;
        }
        pending.cleared = false;
        if (action.type === setAutoCommitEnabled.type) {
          pending.write = action as AutoCommitAction;
          pending.read = false;
        } else {
          pending.read = true;
        }
        if (!pending.running) {
          pending.running = true;
          yield* fork(consumeWorkspaceRequests, workspaceId, pending, requests);
        }
      }
    }
  } finally {
    actions.close();
    requests.clear();
  }
}

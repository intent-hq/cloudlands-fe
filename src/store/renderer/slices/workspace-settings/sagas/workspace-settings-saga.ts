import { buffers, channel, type Channel } from 'redux-saga';
import { call, cancelled, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$shared/generated/ipc-client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { CommandResponse } from '$shared/types';
import { selectAutoCommitEnabled } from '../workspace-settings-selectors';
import { setAutoCommitEnabled } from '../workspace-settings-slice';

const logger = createLogger('WorkspaceSettingsPersistenceSaga');
type AutoCommitAction = ReturnType<typeof setAutoCommitEnabled>;

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
export function* persistWorkspaceAutoCommitWorker(action: AutoCommitAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const autoCommitEnabled = yield* selectAutoCommitEnabled.effect(workspaceId);

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

function* consumeWorkspaceQueue(queue: Channel<AutoCommitAction>): SagaGenerator<void> {
  while (true) {
    const action = yield* take(queue);
    yield* call(persistWorkspaceAutoCommitWorker, action);
  }
}

/**
 * Serializes writes per workspace while retaining only the latest queued value.
 * Active work is allowed to finish; a later value cannot be overwritten by an
 * older queued mutation.
 */
export function* workspaceSettingsSaga(): SagaGenerator<void> {
  const queues = new Map<string, Channel<AutoCommitAction>>();
  try {
    while (true) {
      const action = yield* take(setAutoCommitEnabled);
      const [workspaceId] = action.payload;
      let queue = queues.get(workspaceId);
      if (!queue) {
        queue = channel<AutoCommitAction>(buffers.sliding(1));
        queues.set(workspaceId, queue);
        yield* fork(consumeWorkspaceQueue, queue);
      }
      yield* put(queue, action);
    }
  } finally {
    for (const queue of queues.values()) queue.close();
    if (yield* cancelled()) queues.clear();
  }
}

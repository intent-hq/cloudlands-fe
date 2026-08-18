import { buffers, channel, type Channel } from 'redux-saga';
import {
  all,
  call,
  cancelled,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$shared/generated/ipc-client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { CommandResponse } from '$shared/types';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectAutoCommitEnabled,
  selectSettingsWorkspaceIds,
} from '../workspace-settings-selectors';
import {
  loadAutoCommitSettings,
  refreshAutoCommitSettings,
  setAutoCommitEnabled,
  syncWorkspaceSettings,
} from '../workspace-settings-slice';

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
function* persistAutoCommitLoop(): SagaGenerator<void> {
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

const isAutoCommitToggleFor =
  (workspaceId: string) =>
  (action: { type: string; payload?: unknown }): boolean =>
    action.type === setAutoCommitEnabled.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;

/**
 * Hydrates one workspace's toggle from the daemon-resolved value
 * (`workspace.getAutoCommit`: persisted per-workspace override, else the
 * global `git.autoCommit` — PROTOCOL §5.1). A user toggle racing the read is
 * newer intent, so the stale read result is dropped; a wire failure keeps the
 * current display rather than fabricating a value.
 */
export function* hydrateWorkspaceAutoCommitWorker(workspaceId: string): SagaGenerator<void> {
  try {
    const { settings, toggled } = yield* race({
      settings: call([appClient.settings, appClient.settings.getWorkspaceSettings], workspaceId),
      toggled: take(isAutoCommitToggleFor(workspaceId)),
    });
    if (toggled) return;
    if (!settings) {
      logger.warn('workspace.getAutoCommit returned no value; keeping current toggle state', {
        workspaceId,
      });
      return;
    }
    yield* put(loadAutoCommitSettings(workspaceId, settings.autoCommitEnabled));
  } catch (error) {
    logger.warn('Failed to hydrate auto-commit settings from daemon', { workspaceId, error });
  }
}

type HydrationTrigger = ReturnType<typeof syncWorkspaceSettings | typeof workspaceMounted>;

/**
 * Hydrates the toggle whenever a workspace becomes active (route mount) or a
 * component requests a settings sync. Single-flight per workspace: triggers
 * arriving while a read is in flight are dropped — the in-flight read returns
 * the same daemon value. The `inFlight` set is shared with the refresh loop so
 * the two loops never read the same workspace concurrently.
 */
function* hydrateAutoCommitLoop(inFlight: Set<string>): SagaGenerator<void> {
  yield* takeEvery([syncWorkspaceSettings, workspaceMounted], function* (action: HydrationTrigger) {
    const [workspaceId] = action.payload;
    if (!workspaceId || inFlight.has(workspaceId)) return;
    inFlight.add(workspaceId);
    try {
      yield* call(hydrateWorkspaceAutoCommitWorker, workspaceId);
    } finally {
      inFlight.delete(workspaceId);
    }
  });
}

/**
 * After a global git.autoCommit save (GitWorkspaceSettings dispatches
 * `refreshAutoCommitSettings`), re-hydrates every workspace already tracked in
 * the slice so displayed toggles pick up the daemon-resolved value. Reads run
 * serially to avoid a burst of daemon calls; a save arriving mid-sweep
 * restarts the sweep (takeLatest) so every workspace converges on the latest
 * saved value. Shares the mount/sync loop's `inFlight` set: a workspace with a
 * read already in flight is skipped, so the two loops never issue duplicate
 * concurrent reads whose responses could land out of order.
 */
function* refreshAutoCommitLoop(inFlight: Set<string>): SagaGenerator<void> {
  yield* takeLatest(refreshAutoCommitSettings, function* () {
    const workspaceIds = yield* selectSettingsWorkspaceIds.effect();
    for (const workspaceId of workspaceIds) {
      if (inFlight.has(workspaceId)) continue;
      inFlight.add(workspaceId);
      try {
        yield* call(hydrateWorkspaceAutoCommitWorker, workspaceId);
      } finally {
        inFlight.delete(workspaceId);
      }
    }
  });
}

export function* workspaceSettingsSaga(): SagaGenerator<void> {
  const inFlight = new Set<string>();
  yield* all([
    call(persistAutoCommitLoop),
    call(hydrateAutoCommitLoop, inFlight),
    call(refreshAutoCommitLoop, inFlight),
  ]);
}

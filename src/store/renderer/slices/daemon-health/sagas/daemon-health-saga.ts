import { END, buffers, type EventChannel, type Task } from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  delay,
  fork,
  put,
  take,
  takeEvery,
  takeLeading,
} from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronChannel } from '$store/renderer/utils/ipc-channel';
import {
  connectionStatusChanged,
  fetchSidecarRunLogFailed,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  heartbeatFailed,
  pollSystemStatus,
  pollUnslothStatus,
  spawnSidecarFailed,
  spawnSidecarRequested,
  stopUnslothFailed,
  stopUnslothRequested,
  stopUnslothSucceeded,
  systemStatusFailure,
  systemStatusSuccess,
  unslothStatusFailure,
  unslothStatusSuccess,
} from '../daemon-health-slice';
import { selectDaemonHealth } from '../daemon-health-selectors';
import type {
  BackendTransportInfo,
  SidecarRunLog,
  SystemStatusWirePayload,
  UnslothStatusWirePayload,
} from '../daemon-health-types';

const BACKEND = IPC_CHANNELS.BACKEND;
const POLL_INTERVAL_MS = 10_000;
const INITIAL_DISCONNECTED_BACKOFF_MS = 1_000;
const MAX_DISCONNECTED_BACKOFF_MS = 5_000;

interface BackendStatusPayload {
  status: string;
  transport?: BackendTransportInfo;
  sidecarGaveUp?: boolean;
  sidecarStartupFailed?: boolean;
  reason?: string;
}

interface BackendStatusSnapshot extends BackendStatusPayload {
  sidecarStartupFailedReason?: string;
}

async function invokeGetBackendStatus(): Promise<BackendStatusSnapshot> {
  if (!window.electronAPI) throw new Error('electronAPI is not available');
  return (await window.electronAPI.invoke(BACKEND.GET_STATUS)) as BackendStatusSnapshot;
}

async function invokeSpawnSidecar() {
  if (!window.electronAPI) throw new Error('electronAPI is not available');
  return (await window.electronAPI.invoke(BACKEND.SPAWN_SIDECAR)) as
    | { ok: boolean; spawned: boolean; reason?: string; error?: { message?: string } }
    | undefined;
}

async function invokeSidecarRunLog(): Promise<SidecarRunLog> {
  if (!window.electronAPI) throw new Error('electronAPI is not available');
  return (await window.electronAPI.invoke(BACKEND.GET_SIDECAR_RUN_LOG)) as SidecarRunLog;
}

async function notifyVersionMismatch(transport: BackendTransportInfo): Promise<boolean> {
  try {
    const { toast } = await import('$lib/components/ui/toast');
    const daemonVersion = transport.daemonVersion
      ? ` (v${transport.daemonVersion.replace(/^v/, '')})`
      : '';
    toast.warning(m.daemonStatus_versionMismatch_warning({ version: daemonVersion }), {
      duration: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

function statusAction(payload: BackendStatusPayload, snapshot: boolean) {
  return connectionStatusChanged(payload.status, payload.transport, {
    sidecarGaveUp: payload.sidecarGaveUp,
    sidecarStartupFailed: payload.sidecarStartupFailed,
    reason: snapshot
      ? (payload as BackendStatusSnapshot).sidecarStartupFailedReason
      : payload.reason,
  });
}

function* maybeNotifyVersionMismatch(
  transport: BackendTransportInfo | undefined,
  alreadyNotified: boolean,
) {
  if (!transport?.versionMismatch || alreadyNotified) return alreadyNotified;
  return yield* call(notifyVersionMismatch, transport);
}

export function* daemonStatusSaga() {
  const channel: EventChannel<BackendStatusPayload> = createElectronChannel<BackendStatusPayload>(
    BACKEND.STATUS,
    {
      bufferPolicy: {
        kind: 'lossless',
        rationale: 'Backend connection transitions must retain arrival order during startup.',
      },
    },
  );
  let versionMismatchNotified = false;
  let lastStatus: string | null = null;
  let disconnectedBackoffMs = INITIAL_DISCONNECTED_BACKOFF_MS;
  let pendingDisconnectedTask: Task | null = null;
  try {
    // The channel is installed before GET_STATUS so a push racing the snapshot
    // is buffered and applied after the older boot snapshot.
    try {
      const snapshot = yield* call(invokeGetBackendStatus);
      yield* put(statusAction(snapshot, true));
      lastStatus = snapshot.status;
      versionMismatchNotified = yield* call(
        maybeNotifyVersionMismatch,
        snapshot.transport,
        versionMismatchNotified,
      );
    } catch {
      // Push events and system.status polling still converge the state.
    }

    while (true) {
      const payload: BackendStatusPayload = yield* take(channel);
      if (payload === (END as unknown as BackendStatusPayload)) break;
      if (payload.status === 'disconnected' && lastStatus === 'disconnected') {
        if (pendingDisconnectedTask) yield* cancel(pendingDisconnectedTask);
        const delayMs = disconnectedBackoffMs;
        disconnectedBackoffMs = Math.min(delayMs * 2, MAX_DISCONNECTED_BACKOFF_MS);
        pendingDisconnectedTask = yield* fork(function* delayedDisconnectedStatus() {
          yield* delay(delayMs);
          yield* put(statusAction(payload, false));
        });
      } else {
        if (pendingDisconnectedTask) {
          yield* cancel(pendingDisconnectedTask);
          pendingDisconnectedTask = null;
        }
        yield* put(statusAction(payload, false));
        if (payload.status !== 'disconnected') disconnectedBackoffMs = INITIAL_DISCONNECTED_BACKOFF_MS;
      }
      lastStatus = payload.status;
      versionMismatchNotified = yield* call(
        maybeNotifyVersionMismatch,
        payload.transport,
        versionMismatchNotified,
      );
    }
  } finally {
    if (pendingDisconnectedTask) yield* cancel(pendingDisconnectedTask);
    channel.close();
  }
}

export function* pollSystemStatusSaga() {
  try {
    const status = yield* call(backendRequest<SystemStatusWirePayload>, 'system.status');
    yield* put(systemStatusSuccess(status, new Date().toISOString()));
  } catch {
    yield* put(systemStatusFailure());
    const health = yield* selectDaemonHealth.effect();
    if (health === 'healthy') yield* put(heartbeatFailed());
  }
}

function* systemPollingLoop() {
  yield* put(pollSystemStatus());
  while (true) {
    yield* delay(POLL_INTERVAL_MS);
    yield* put(pollSystemStatus());
  }
}

function* watchSystemStatusPolls() {
  yield* takeLeading(pollSystemStatus, pollSystemStatusSaga);
}

export function* pollUnslothStatusSaga() {
  try {
    const status = yield* call(backendRequest<UnslothStatusWirePayload>, 'unsloth.status');
    yield* put(unslothStatusSuccess(status));
  } catch {
    yield* put(unslothStatusFailure());
  }
}

function* watchUnslothStatusPolls() {
  const channel = yield* actionChannel(pollUnslothStatus, buffers.sliding(1));
  try {
    while (true) {
      yield* take(channel);
      yield* call(pollUnslothStatusSaga);
    }
  } finally {
    channel.close();
  }
}

export function* stopUnslothSaga() {
  try {
    const result = yield* call(backendRequest<{ stopped: boolean }>, 'unsloth.stop');
    yield* put(stopUnslothSucceeded(result.stopped));
    yield* put(pollUnslothStatus());
  } catch (error) {
    yield* put(stopUnslothFailed(error instanceof Error ? error.message : String(error)));
  }
}

function* spawnSidecarSaga() {
  try {
    const result = yield* call(invokeSpawnSidecar);
    if (!result?.ok) {
      yield* put(
        spawnSidecarFailed(
          result?.error?.message ?? result?.reason ?? m.daemonStatus_spawnSidecarFailed_error(),
        ),
      );
    }
  } catch (error) {
    yield* put(spawnSidecarFailed(error instanceof Error ? error.message : String(error)));
  }
}

function* fetchSidecarRunLogSaga() {
  try {
    const log = yield* call(invokeSidecarRunLog);
    yield* put(fetchSidecarRunLogSucceeded(log));
  } catch (error) {
    yield* put(fetchSidecarRunLogFailed(error instanceof Error ? error.message : String(error)));
  }
}

function* watchDaemonControls() {
  yield* takeEvery(spawnSidecarRequested, spawnSidecarSaga);
  yield* takeEvery(fetchSidecarRunLogRequested, fetchSidecarRunLogSaga);
  yield* takeLeading(stopUnslothRequested, stopUnslothSaga);
}

export function* daemonHealthSaga() {
  if (typeof window === 'undefined' || !window.electronAPI) return;
  yield* fork(daemonStatusSaga);
  yield* fork(watchSystemStatusPolls);
  yield* fork(watchUnslothStatusPolls);
  yield* fork(watchDaemonControls);
  yield* call(systemPollingLoop);
}

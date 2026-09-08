import { buffers, type EventChannel } from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  delay,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  takeLeading,
} from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { compareToPinnedVersion } from '$shared/intentd-version-compare';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronChannel } from '$store/renderer/utils/ipc-channel';
import { takeWithBackoff } from '$store/renderer/utils/take-with-backoff';
import { selectDaemonConnectionGeneration } from '../daemon-health-selectors';
import {
  connectionStatusChanged,
  fetchSidecarRunLogFailed,
  fetchSidecarRunLogRequested,
  fetchSidecarRunLogSucceeded,
  pollSystemStatus,
  pollUnslothStatus,
  openLocalAndSpawnRequested,
  openLocalAndSpawnSucceeded,
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
import type {
  BackendTransportInfo,
  DaemonStatusCheckFailureKind,
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
  /** Reconnect attempts since the last successful connect (#1750). */
  reconnectAttempts?: number;
  /**
   * Epoch ms of the first drop main observed while a user-requested daemon
   * update is outstanding for this backend.
   */
  daemonUpdateDisconnectedAt?: number;
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
    { ok: boolean; spawned: boolean; reason?: string; error?: { message?: string } } | undefined;
}

async function invokeOpenLocalAndSpawn() {
  if (!window.electronAPI) throw new Error('electronAPI is not available');
  return (await window.electronAPI.invoke(BACKEND.OPEN_LOCAL_AND_SPAWN)) as
    { ok: boolean; spawned: boolean; reason?: string; error?: { message?: string } } | undefined;
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

async function invokeRestartOrphanedSidecar() {
  if (!window.electronAPI) throw new Error('electronAPI is not available');
  return (await window.electronAPI.invoke(BACKEND.RESTART_ORPHANED_SIDECAR)) as
    { ok: boolean; spawned: boolean; cancelled?: boolean; reason?: string } | undefined;
}

/**
 * Tracks whether the orphan offer was surfaced this session. A mutable ref
 * (not a plain boolean) so the async restart-failure handler can reset it —
 * a later status push (which still carries `isOrphanedSidecar`) then
 * re-offers instead of leaving the user with no path back.
 */
interface OrphanNotifyState {
  notified: boolean;
}

/**
 * Orphaned-sidecar recovery offer (#2444): the adopted daemon is a leftover
 * from a crashed/force-quit prior app session (its executable lives inside
 * this app's own bundle), so offer a restart with the bundled daemon. The
 * action invokes the main-process recovery handler, which re-verifies the
 * classification and confirms before interrupting responding agents.
 */
async function notifyOrphanedSidecar(
  transport: BackendTransportInfo,
  notifyState: OrphanNotifyState,
): Promise<boolean> {
  try {
    const { toast } = await import('$lib/components/ui/toast');
    const daemonVersion = transport.daemonVersion
      ? ` (v${transport.daemonVersion.replace(/^v/, '')})`
      : '';
    const onRestartFailed = async () => {
      notifyState.notified = false;
      const { toast: toastLib } = await import('$lib/components/ui/toast');
      toastLib.error(m.daemonStatus_orphanRestartFailed_error());
    };
    toast.warning(m.daemonStatus_orphanedSidecar_warning({ version: daemonVersion }), {
      duration: 30_000,
      action: {
        label: m.daemonStatus_orphanedSidecar_restart_action(),
        onClick: () => {
          void invokeRestartOrphanedSidecar()
            .then(async (result) => {
              if (result && !result.ok && !result.cancelled) await onRestartFailed();
            })
            .catch(onRestartFailed);
        },
      },
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
    reconnectAttempts: payload.reconnectAttempts,
    daemonUpdateDisconnectedAt: payload.daemonUpdateDisconnectedAt,
  });
}

/**
 * True when the actionable behind-pin Update toast (connections-saga) owns
 * this mismatch: the daemon explicitly reports self-update support AND is
 * strictly behind the pin. A newer-than-pin daemon or one without update
 * support keeps the passive warning.
 */
function ownedByBehindPinToast(transport: BackendTransportInfo): boolean {
  if (transport.updateSupported !== true) return false;
  if (!transport.daemonVersion || !transport.pinnedVersion) return false;
  return compareToPinnedVersion(transport.daemonVersion, transport.pinnedVersion) === 'older';
}

function* maybeNotifyVersionMismatch(
  transport: BackendTransportInfo | undefined,
  alreadyNotified: boolean,
) {
  // A cleared mismatch resets the latch so a later genuine mismatch (e.g. the
  // daemon downgraded again) notifies once more with the current version.
  if (!transport?.versionMismatch) return false;
  // An orphaned sidecar gets its own actionable toast (see
  // maybeNotifyOrphanedSidecar), and a behind-pin daemon with update support
  // gets the actionable Update toast (connections-saga); the generic mismatch
  // warning would be redundant noise on the same daemon.
  if (transport.isOrphanedSidecar || ownedByBehindPinToast(transport) || alreadyNotified)
    return alreadyNotified;
  return yield* call(notifyVersionMismatch, transport);
}

function* maybeNotifyOrphanedSidecar(
  transport: BackendTransportInfo | undefined,
  notifyState: OrphanNotifyState,
) {
  if (!transport?.isOrphanedSidecar || notifyState.notified) return;
  notifyState.notified = yield* call(notifyOrphanedSidecar, transport, notifyState);
}

function* daemonStatusSaga() {
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
  const orphanNotifyState: OrphanNotifyState = { notified: false };
  let initialStatus: BackendStatusPayload | null = null;
  try {
    // The channel is installed before GET_STATUS so a push racing the snapshot
    // is buffered and applied after the older boot snapshot.
    try {
      const snapshot = yield* call(invokeGetBackendStatus);
      yield* put(statusAction(snapshot, true));
      initialStatus = snapshot;
      yield* call(maybeNotifyOrphanedSidecar, snapshot.transport, orphanNotifyState);
      versionMismatchNotified = yield* call(
        maybeNotifyVersionMismatch,
        snapshot.transport,
        versionMismatchNotified,
      );
    } catch {
      // Push events and system.status polling still converge the state.
    }
    // Polling starts once the boot snapshot has settled either way: a
    // successful snapshot binds the first poll to that connection, and a
    // failed one must not leave the app without any poll until main happens
    // to push a status.
    yield* fork(systemPollingLoop);

    yield* takeWithBackoff(
      channel,
      function* handleStatusPayload(payload: BackendStatusPayload) {
        yield* put(statusAction(payload, false));
        yield* call(maybeNotifyOrphanedSidecar, payload.transport, orphanNotifyState);
        versionMismatchNotified = yield* call(
          maybeNotifyVersionMismatch,
          payload.transport,
          versionMismatchNotified,
        );
      },
      {
        initialDelayMs: INITIAL_DISCONNECTED_BACKOFF_MS,
        maxDelayMs: MAX_DISCONNECTED_BACKOFF_MS,
        initialPrevious: initialStatus,
        shouldBackoff: (payload, previous) =>
          payload.status === 'disconnected' && previous?.status === 'disconnected',
      },
    );
  } finally {
    channel.close();
  }
}

/**
 * Reduce a failed poll to a safe category at the effect boundary. Only a
 * transport-tagged `TIMEOUT` (browser WebSocket transport) is a known
 * timeout; the Electron IPC path reports timeouts as a generic
 * `TRANSPORT_ERROR`, so those stay generic rather than being guessed from
 * the message. Raw errors never reach the store.
 */
function classifyStatusCheckFailure(error: unknown): DaemonStatusCheckFailureKind {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'TIMEOUT' ? 'timeout' : 'status-check-failed';
}

export function* pollSystemStatusSaga() {
  // Snapshot the connection generation before the request: the reducer
  // discards the terminal action when a connection lifecycle change happened
  // meanwhile, so a slow poll can never report on a connection it did not
  // observe.
  const connectionGeneration = yield* selectDaemonConnectionGeneration.effect();
  try {
    const status = yield* call(backendRequest<SystemStatusWirePayload>, 'system.status');
    yield* put(systemStatusSuccess(status, new Date().toISOString(), connectionGeneration));
  } catch (error) {
    yield* put(
      systemStatusFailure(
        {
          kind: classifyStatusCheckFailure(error),
          failedAt: new Date().toISOString(),
        },
        connectionGeneration,
      ),
    );
  }
}

/**
 * Fixed-cadence poll trigger, forked by `daemonStatusSaga` once the boot
 * snapshot has settled so the first poll is bound to a known connection
 * lifecycle rather than racing the snapshot (which would only discard it).
 */
function* systemPollingLoop() {
  yield* put(pollSystemStatus());
  while (true) {
    yield* delay(POLL_INTERVAL_MS);
    yield* put(pollSystemStatus());
  }
}

/**
 * Run one poll to completion unless the connection generation changes
 * underneath it. Status notifications that leave the generation alone
 * (same-connection metadata refreshes) keep waiting on the same request — the
 * transport cannot abort it, so re-issuing would only fan out requests.
 * Returns whether the new lifecycle should be polled right away.
 */
function* runPollBoundToConnection() {
  const generation = yield* selectDaemonConnectionGeneration.effect();
  const poll = yield* fork(pollSystemStatusSaga);
  while (true) {
    const { lifecycle } = yield* race({
      settled: join(poll),
      lifecycle: take(connectionStatusChanged),
    });
    if (!lifecycle) return false;
    const current = yield* selectDaemonConnectionGeneration.effect();
    if (current === generation) continue;
    yield* cancel(poll);
    return lifecycle.payload[0] === 'connected';
  }
}

/**
 * One poll in flight at a time (triggers during a poll are dropped, as with
 * takeLeading). A connection lifecycle change cancels the in-flight poll —
 * its result belongs to the previous connection — and, when the new
 * lifecycle is connected, polls it right away instead of leaving its stats
 * to the next interval.
 */
function* watchSystemStatusPolls() {
  while (true) {
    yield* take(pollSystemStatus);
    let poll = true;
    while (poll) {
      poll = yield* call(runPollBoundToConnection);
      if (poll) yield* put(pollSystemStatus());
    }
  }
}

function* pollUnslothStatusSaga() {
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

function* stopUnslothSaga() {
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

function* openLocalAndSpawnSaga() {
  try {
    const result = yield* call(invokeOpenLocalAndSpawn);
    if (result?.ok) {
      // This window keeps its own (dead) backend, so no 'connected' status
      // event ever reaches it — clear the pending flag explicitly.
      yield* put(openLocalAndSpawnSucceeded());
    } else {
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
  yield* takeEvery(openLocalAndSpawnRequested, openLocalAndSpawnSaga);
  yield* takeEvery(fetchSidecarRunLogRequested, fetchSidecarRunLogSaga);
  yield* takeLeading(stopUnslothRequested, stopUnslothSaga);
}

export function* daemonHealthSaga() {
  if (typeof window === 'undefined' || !window.electronAPI) return;
  // The poll watcher is forked first so the boot poll issued by the status
  // saga's polling loop always has a listener.
  yield* fork(watchSystemStatusPolls);
  yield* fork(daemonStatusSaga);
  yield* fork(watchUnslothStatusPolls);
  yield* fork(watchDaemonControls);
}

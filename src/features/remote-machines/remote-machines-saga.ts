/**
 * Remote machines (renderer): load the current backend's exposed machines
 * and drive the owner actions. The credential-bearing expose relay runs in the
 * main process (`remote-machines:*` IPC); the renderer only sees the saved
 * machine rows and failure codes, never an executor token.
 */

import { call, delay, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  parseExecutorBackend,
  parseRemoteMachine,
  type ExecutorBackend,
  type RemoteMachine,
  type RemoteMachineExposeResult,
  type RemoteMachineFailure,
  type RemoteMachineUnexposeResult,
} from '$shared/types/remote-machines';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { backendRequest, observeBackendNodeCapabilities } from '$lib/client/live/backend-transport';
import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  executorBackendRevoked,
  executorRevokeRequested,
  remoteMachineChanged,
  remoteMachineExposeRequested,
  remoteMachineOperationSettled,
  remoteMachineOperationStarted,
  remoteMachineRemoved,
  remoteMachinesLoaded,
  remoteMachinesRefreshRequested,
  remoteMachineUnexposeRequested,
} from './remote-machines-slice';
import { selectConnectionLabel, selectCurrentBackendLabel } from './remote-machines-selectors';

function bridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('remote machines bridge unavailable'); // i18n-ignore (developer diagnostic)
  return api;
}

// Each call names its channel so the IPC reachability scan can see the main handler's caller.
const invokeExpose = async (params: unknown): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.EXPOSE, params);
const invokeUnexpose = async (params: unknown): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.UNEXPOSE, params);
const invokeMachineFingerprint = async (connectionId: string): Promise<unknown> =>
  bridge().invoke(IPC_CHANNELS.REMOTE_MACHINES.MACHINE_FINGERPRINT, connectionId);

function errorFailure(error: unknown): RemoteMachineFailure {
  return {
    success: false,
    code: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

const FAILURE_CODES: ReadonlySet<string> = new Set<RemoteMachineFailure['code']>([
  'unsupported-backend',
  'same-machine',
  'not-owner',
  'machine-not-connected',
  'listener-off',
  'machine-update-required',
  'machine-unreachable',
  'machine-in-use',
  'failed',
]);

/**
 * Narrow a `remote-machines:*` bridge reply. A bridge without the channel (the
 * web build's mock `electronAPI`) answers `{ success: false, error }`, which
 * becomes a generic failure instead of leaking an unknown shape into state.
 */
function bridgeFailure(reply: unknown): RemoteMachineFailure | null {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.success === false && typeof value.code === 'string' && FAILURE_CODES.has(value.code))
    return reply as RemoteMachineFailure;
  return {
    success: false,
    code: 'failed',
    ...(typeof value.error === 'string' ? { message: value.error } : {}),
  };
}

function exposeReply(reply: unknown): RemoteMachineExposeResult {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.success === true) {
    const machine = parseRemoteMachine(value.machine);
    if (machine) return { success: true, machine };
  }
  return bridgeFailure(reply) as RemoteMachineFailure;
}

function unexposeReply(reply: unknown): RemoteMachineUnexposeResult {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.success === true) return { success: true, revoked: value.revoked === true };
  return bridgeFailure(reply) as RemoteMachineFailure;
}

/** The Labs "Remote agents" flag is the only switch: off, nothing is read or changed. */
function labsEnabled(): boolean {
  return selectLabsRemoteAgentsEnabled.select(store.state);
}

function generation(): number {
  return store.state.daemonHealth.connectionGeneration;
}

/**
 * `remoteMachines: 1` from the current hello, or null while unknown: the
 * transport clears its capability snapshot whenever another `client.hello` is
 * in flight, and reports no snapshot until that reply lands.
 */
async function readSupported(): Promise<boolean | null> {
  try {
    const hello = (await observeBackendNodeCapabilities()) as {
      server?: { capabilities?: { remoteMachines?: unknown } | null };
    } | null;
    const capabilities = hello?.server?.capabilities;
    if (!capabilities) return null;
    return capabilities.remoteMachines === 1;
  } catch {
    return null;
  }
}

/** Retry an unknown capability snapshot briefly before treating it as unsupported. */
const CAPABILITY_RETRIES = 10;
const CAPABILITY_RETRY_MS = 500;

async function readMachines(): Promise<RemoteMachine[]> {
  const result = await backendRequest<{ machines?: unknown }>('remoteMachines.list');
  return Array.isArray(result?.machines)
    ? result.machines.flatMap((value) => {
        const machine = parseRemoteMachine(value);
        return machine ? [machine] : [];
      })
    : [];
}

/** `executor.list` on the current backend's own machine; null when it is unavailable. */
async function readExecutorBackends(): Promise<ExecutorBackend[] | null> {
  try {
    const result = await backendRequest<{ backends?: unknown }>('executor.list');
    if (!Array.isArray(result?.backends)) return null;
    return result.backends.flatMap((value) => {
      const backend = parseExecutorBackend(value);
      return backend ? [backend] : [];
    });
  } catch {
    return null;
  }
}

async function readLocalFingerprint(): Promise<string | null> {
  try {
    const reply = await invokeMachineFingerprint(LOCAL_CONNECTION_ID);
    return typeof reply === 'string' ? reply : null;
  } catch {
    return null;
  }
}

/** A snapshot read against one connection generation. */
function* readSnapshot(): SagaGenerator<Parameters<typeof remoteMachinesLoaded>[0]> {
  let known = yield* call(readSupported);
  for (let attempt = 0; known === null && attempt < CAPABILITY_RETRIES; attempt += 1) {
    yield* delay(CAPABILITY_RETRY_MS);
    known = yield* call(readSupported);
  }
  const supported = known === true;
  let machines: RemoteMachine[] = [];
  let localFingerprint: string | null = null;
  if (supported) {
    try {
      machines = yield* call(readMachines);
    } catch {
      machines = [];
    }
    localFingerprint = yield* call(readLocalFingerprint);
  }
  const executorBackends = yield* call(readExecutorBackends);
  return { supported, machines, localFingerprint, executorBackends };
}

/**
 * The connection generation also moves on the first connect, which does not
 * dispatch `backendReconnected`; a snapshot read across a move is read again
 * rather than dropped, so the section does not stay hidden after startup.
 */
const SNAPSHOT_ATTEMPTS = 3;

function* refresh(): SagaGenerator<void> {
  if (!labsEnabled()) return;
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    const started = generation();
    const snapshot = yield* call(readSnapshot);
    if (started === generation()) {
      yield* put(remoteMachinesLoaded(snapshot));
      return;
    }
  }
}

function* expose(action: ReturnType<typeof remoteMachineExposeRequested>): SagaGenerator<void> {
  if (!labsEnabled()) return;
  const [connectionId, enableListener] = action.payload;
  if (store.state.remoteMachines.pending[connectionId]) return;
  const machine = selectConnectionLabel.select(store.state, connectionId);
  const backend = selectCurrentBackendLabel.select(store.state);
  if (!enableListener) {
    const accepted = yield* call(confirm, {
      title: m.remoteMachines_expose_confirmTitle({ machine, backend }),
      description: m.remoteMachines_expose_warning({ machine, backend }),
      confirmLabel: m.remoteMachines_expose_confirm_label(),
    });
    if (!accepted) return;
  }
  const started = generation();
  yield* put(remoteMachineOperationStarted(connectionId, 'exposing'));
  let result: RemoteMachineExposeResult;
  try {
    result = exposeReply(
      yield* call(invokeExpose, {
        machineConnectionId: connectionId,
        ...(enableListener ? { enableListener } : {}),
      }),
    );
  } catch (error) {
    result = errorFailure(error);
  }
  if (started !== generation()) return;
  if (result.success) {
    yield* put(remoteMachineChanged(result.machine));
    yield* put(remoteMachineOperationSettled(connectionId, null));
    yield* call(notify.success, m.remoteMachines_expose_success({ machine, backend }));
  } else {
    yield* put(remoteMachineOperationSettled(connectionId, result));
  }
}

function* unexpose(action: ReturnType<typeof remoteMachineUnexposeRequested>): SagaGenerator<void> {
  if (!labsEnabled()) return;
  const [machineId, connectionId, stopAgents] = action.payload;
  if (store.state.remoteMachines.pending[machineId]) return;
  const name = store.state.remoteMachines.machines[machineId]?.name ?? machineId;
  const backend = selectCurrentBackendLabel.select(store.state);
  if (!stopAgents) {
    const accepted = yield* call(confirm, {
      title: m.remoteMachines_unexpose_confirmTitle({ machine: name, backend }),
      description: m.remoteMachines_unexpose_confirm_description({ machine: name, backend }),
      confirmLabel: m.remoteMachines_unexpose_label(),
      destructive: true,
    });
    if (!accepted) return;
  }
  const started = generation();
  yield* put(remoteMachineOperationStarted(machineId, 'removing'));
  let result: RemoteMachineUnexposeResult;
  try {
    result = unexposeReply(
      yield* call(invokeUnexpose, {
        machineId,
        ...(connectionId ? { machineConnectionId: connectionId } : {}),
        ...(stopAgents ? { stopAgents: true } : {}),
      }),
    );
  } catch (error) {
    result = errorFailure(error);
  }
  if (started !== generation()) return;
  if (!result.success) {
    yield* put(remoteMachineOperationSettled(machineId, result));
    return;
  }
  yield* put(remoteMachineRemoved(machineId));
  yield* put(remoteMachineOperationSettled(machineId, null));
  if (result.revoked)
    yield* call(notify.success, m.remoteMachines_unexpose_success({ machine: name }));
  else yield* call(notify.warning, m.remoteMachines_unexpose_unrevoked_warning({ machine: name }));
}

function* revokeExecutor(action: ReturnType<typeof executorRevokeRequested>): SagaGenerator<void> {
  if (!labsEnabled()) return;
  const [credentialId] = action.payload;
  if (store.state.remoteMachines.pending[credentialId]) return;
  const backend = store.state.remoteMachines.executorBackends?.find(
    (entry) => entry.credentialId === credentialId,
  );
  if (!backend) return;
  const accepted = yield* call(confirm, {
    title: m.remoteMachines_revoke_confirmTitle({ backend: backend.backendName }),
    description: m.remoteMachines_revoke_confirm_description({ backend: backend.backendName }),
    confirmLabel: m.remoteMachines_revoke_label(),
    destructive: true,
  });
  if (!accepted) return;
  const started = generation();
  yield* put(remoteMachineOperationStarted(credentialId, 'revoking'));
  try {
    yield* call(backendRequest, 'executor.revoke', { credentialId });
    if (started !== generation()) return;
    yield* put(executorBackendRevoked(credentialId));
    yield* put(remoteMachineOperationSettled(credentialId, null));
  } catch (error) {
    if (started !== generation()) return;
    yield* put(remoteMachineOperationSettled(credentialId, errorFailure(error)));
  }
}

export function* remoteMachinesSaga(): SagaGenerator<void> {
  yield* takeLatest(
    [remoteMachinesRefreshRequested, backendReconnected, setLabsRemoteAgentsEnabled],
    refresh,
  );
  yield* takeEvery(remoteMachineExposeRequested, expose);
  yield* takeEvery(remoteMachineUnexposeRequested, unexpose);
  yield* takeEvery(executorRevokeRequested, revokeExecutor);
}

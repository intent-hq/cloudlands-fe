/**
 * Remote machines (renderer): load the current backend's exposed machines
 * and drive the owner actions. The credential-bearing expose relay runs in the
 * main process (`remote-machines:*` IPC); the renderer only sees the saved
 * machine rows and failure codes, never an executor token.
 */

import { call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';
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

const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;

async function invokeRemoteMachines<T>(channel: string, params?: unknown): Promise<T> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('remote machines bridge unavailable'); // i18n-ignore (developer diagnostic)
  return (await api.invoke(channel, params)) as T;
}

function errorFailure(error: unknown): RemoteMachineFailure {
  return {
    success: false,
    code: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function generation(): number {
  return store.state.daemonHealth.connectionGeneration;
}

async function readSupported(): Promise<boolean> {
  try {
    const hello = (await observeBackendNodeCapabilities()) as {
      server?: { capabilities?: { remoteMachines?: unknown } | null };
    } | null;
    return hello?.server?.capabilities?.remoteMachines === 1;
  } catch {
    return false;
  }
}

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
    return await invokeRemoteMachines<string | null>(
      CHANNELS.MACHINE_FINGERPRINT,
      LOCAL_CONNECTION_ID,
    );
  } catch {
    return null;
  }
}

function* refresh(): SagaGenerator<void> {
  const started = generation();
  const supported = yield* call(readSupported);
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
  if (started !== generation()) return;
  yield* put(remoteMachinesLoaded({ supported, machines, localFingerprint, executorBackends }));
}

function* expose(action: ReturnType<typeof remoteMachineExposeRequested>): SagaGenerator<void> {
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
    result = yield* call(invokeRemoteMachines<RemoteMachineExposeResult>, CHANNELS.EXPOSE, {
      machineConnectionId: connectionId,
      ...(enableListener ? { enableListener } : {}),
    });
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
    result = yield* call(invokeRemoteMachines<RemoteMachineUnexposeResult>, CHANNELS.UNEXPOSE, {
      machineId,
      ...(connectionId ? { machineConnectionId: connectionId } : {}),
      ...(stopAgents ? { stopAgents: true } : {}),
    });
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
  yield* takeLatest([remoteMachinesRefreshRequested, backendReconnected], refresh);
  yield* takeEvery(remoteMachineExposeRequested, expose);
  yield* takeEvery(remoteMachineUnexposeRequested, unexpose);
  yield* takeEvery(executorRevokeRequested, revokeExecutor);
}

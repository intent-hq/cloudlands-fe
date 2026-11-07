/**
 * Cloud machines (renderer): load the E2B provider and live sandboxes of the
 * current backend and drive the owner actions (PROTOCOL `methods/nodes.md` →
 * "Cloud machines (E2B)"). The API key goes straight from the form into one
 * `cloudMachines.configure` request; it is never put in state or logged.
 */

import { call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import {
  parseCloudMachineError,
  parseCloudMachineProvider,
  type CloudMachineProvider,
} from '$shared/types/cloud-machines';
import { parseRemoteMachine, type RemoteMachine } from '$shared/types/remote-machines';
import { backendRequest, observeBackendNodeCapabilities } from '$lib/client/live/backend-transport';
import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { store } from '$store/renderer/store';
import { selectLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import {
  CLOUD_CONFIGURE_KEY,
  CLOUD_REMOVE_KEY,
  CLOUD_VALIDATE_KEY,
  cloudMachineChanged,
  cloudMachineDeleteRequested,
  cloudMachineOperationSettled,
  cloudMachineOperationStarted,
  cloudMachinePauseRequested,
  cloudMachineRemoved,
  cloudMachinesConfigureRequested,
  cloudMachinesLoaded,
  cloudMachinesRefreshRequested,
  cloudMachinesRemoveRequested,
  cloudMachineValidated,
  cloudProviderChanged,
  cloudProviderRemoved,
  type CloudMachineFailure,
} from './cloud-machines-slice';
import { sandboxLabel } from './cloud-machines-format';

const PROVIDER = 'e2b';

function generation(): number {
  return store.state.daemonHealth.connectionGeneration;
}

/** A failed request in the app's words; the daemon's own message is kept as is. */
function cloudFailure(error: unknown): CloudMachineFailure {
  const data = (error as { data?: unknown } | null)?.data;
  const code = (data as { code?: unknown } | null)?.code;
  const rpcCode = (error as { rpcCode?: unknown } | null)?.rpcCode;
  const cloud = parseCloudMachineError(data);
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(cloud ? { cloud } : {}),
    ...(code === 'machine-in-use' ? { inUse: true } : {}),
    ...(rpcCode === -32003 ? { forbidden: true } : {}),
  };
}

async function readCloudSupported(): Promise<boolean> {
  try {
    const hello = (await observeBackendNodeCapabilities()) as {
      server?: { capabilities?: { remoteMachines?: unknown; cloudMachines?: unknown } | null };
    } | null;
    const capabilities = hello?.server?.capabilities;
    return capabilities?.remoteMachines === 1 && capabilities.cloudMachines === 1;
  } catch {
    return false;
  }
}

async function readList(): Promise<{
  providers: CloudMachineProvider[];
  machines: RemoteMachine[];
}> {
  const result = await backendRequest<{ providers?: unknown; machines?: unknown }>(
    'cloudMachines.list',
  );
  return {
    providers: Array.isArray(result?.providers)
      ? result.providers.flatMap((value) => parseCloudMachineProvider(value) ?? [])
      : [],
    machines: Array.isArray(result?.machines)
      ? result.machines.flatMap((value) => {
          const machine = parseRemoteMachine(value);
          return machine?.cloud ? [machine] : [];
        })
      : [],
  };
}

function* refresh(): SagaGenerator<void> {
  if (!selectLabsRemoteAgentsEnabled.select(store.state)) return;
  if (!store.state.remoteMachines.supported) {
    yield* put(cloudMachinesLoaded({ supported: false, providers: [], machines: [], readAt: 0 }));
    return;
  }
  const started = generation();
  const supported = yield* call(readCloudSupported);
  if (!supported) {
    if (started === generation())
      yield* put(cloudMachinesLoaded({ supported: false, providers: [], machines: [], readAt: 0 }));
    return;
  }
  let list: Awaited<ReturnType<typeof readList>> | null = null;
  try {
    list = yield* call(readList);
  } catch {
    list = null;
  }
  if (started !== generation() || !list) return;
  yield* put(cloudMachinesLoaded({ supported: true, ...list, readAt: Date.now() }));
}

function* configure(
  action: ReturnType<typeof cloudMachinesConfigureRequested>,
): SagaGenerator<void> {
  const [input, validateOnly] = action.payload;
  const key = validateOnly ? CLOUD_VALIDATE_KEY : CLOUD_CONFIGURE_KEY;
  if (store.state.cloudMachines.pending[key]) return;
  const started = generation();
  yield* put(cloudMachineOperationStarted(key, validateOnly ? 'testing' : 'saving'));
  if (validateOnly) yield* put(cloudMachineValidated(null));
  try {
    const result = yield* call(backendRequest<{ provider?: unknown }>, 'cloudMachines.configure', {
      provider: PROVIDER,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.size ? { size: input.size } : {}),
      ...(input.idlePauseMinutes !== undefined ? { idlePauseMinutes: input.idlePauseMinutes } : {}),
      ...(input.pausedDeleteDays !== undefined ? { pausedDeleteDays: input.pausedDeleteDays } : {}),
      ...(validateOnly ? { validateOnly: true } : {}),
    });
    if (started !== generation()) return;
    const provider = parseCloudMachineProvider(result?.provider);
    if (validateOnly) yield* put(cloudMachineValidated(provider));
    else if (provider) yield* put(cloudProviderChanged(provider));
    yield* put(cloudMachineOperationSettled(key, null));
    if (!validateOnly) yield* call(notify.success, m.cloudMachines_saved_toast());
  } catch (error) {
    if (started !== generation()) return;
    yield* put(cloudMachineOperationSettled(key, cloudFailure(error)));
  }
}

function* remove(action: ReturnType<typeof cloudMachinesRemoveRequested>): SagaGenerator<void> {
  const [stopAgents] = action.payload;
  if (store.state.cloudMachines.pending[CLOUD_REMOVE_KEY]) return;
  const sandboxes = Object.keys(store.state.cloudMachines.machines).length;
  const accepted = yield* call(confirm, {
    title: m.cloudMachines_remove_confirmTitle(),
    description:
      sandboxes > 0
        ? m.cloudMachines_remove_confirmWithSandboxes_description()
        : m.cloudMachines_remove_confirm_description(),
    confirmLabel: m.cloudMachines_remove_label(),
    destructive: true,
  });
  if (!accepted) return;
  const started = generation();
  yield* put(cloudMachineOperationStarted(CLOUD_REMOVE_KEY, 'removing'));
  try {
    const result = yield* call(
      backendRequest<{ unconfirmedStops?: unknown }>,
      'cloudMachines.remove',
      {
        provider: PROVIDER,
        ...(stopAgents || sandboxes > 0 ? { stopAgents: true } : {}),
      },
    );
    if (started !== generation()) return;
    yield* put(cloudProviderRemoved(PROVIDER));
    for (const machineId of Object.keys(store.state.cloudMachines.machines))
      yield* put(cloudMachineRemoved(machineId));
    yield* put(cloudMachineOperationSettled(CLOUD_REMOVE_KEY, null));
    yield* call(unconfirmedWarning, result?.unconfirmedStops);
  } catch (error) {
    if (started !== generation()) return;
    yield* put(cloudMachineOperationSettled(CLOUD_REMOVE_KEY, cloudFailure(error)));
  }
}

function* unconfirmedWarning(stops: unknown): SagaGenerator<void> {
  if (Array.isArray(stops) && stops.length > 0)
    yield* call(notify.warning, m.cloudMachines_unconfirmedStops_warning());
}

function* pause(action: ReturnType<typeof cloudMachinePauseRequested>): SagaGenerator<void> {
  const [machineId] = action.payload;
  if (store.state.cloudMachines.pending[machineId]) return;
  const started = generation();
  yield* put(cloudMachineOperationStarted(machineId, 'pausing'));
  try {
    const result = yield* call(backendRequest<{ machine?: unknown }>, 'cloudMachines.pause', {
      machineId,
    });
    if (started !== generation()) return;
    const machine = parseRemoteMachine(result?.machine);
    if (machine?.cloud) yield* put(cloudMachineChanged(machine, Date.now()));
    yield* put(cloudMachineOperationSettled(machineId, null));
  } catch (error) {
    if (started !== generation()) return;
    yield* put(cloudMachineOperationSettled(machineId, cloudFailure(error)));
  }
}

function* deleteSandbox(
  action: ReturnType<typeof cloudMachineDeleteRequested>,
): SagaGenerator<void> {
  const [machineId] = action.payload;
  if (store.state.cloudMachines.pending[machineId]) return;
  const machine = store.state.cloudMachines.machines[machineId];
  if (!machine) return;
  const accepted = yield* call(confirm, {
    title: m.cloudMachines_delete_confirmTitle({ agent: sandboxLabel(machine) }),
    description: m.cloudMachines_delete_confirm_description(),
    confirmLabel: m.cloudMachines_delete_label(),
    destructive: true,
  });
  if (!accepted) return;
  const started = generation();
  yield* put(cloudMachineOperationStarted(machineId, 'deleting'));
  try {
    const result = yield* call(
      backendRequest<{ unconfirmedStops?: unknown }>,
      'cloudMachines.kill',
      {
        machineId,
      },
    );
    if (started !== generation()) return;
    yield* put(cloudMachineRemoved(machineId));
    yield* put(cloudMachineOperationSettled(machineId, null));
    yield* call(unconfirmedWarning, result?.unconfirmedStops);
  } catch (error) {
    if (started !== generation()) return;
    yield* put(cloudMachineOperationSettled(machineId, cloudFailure(error)));
  }
}

export function* cloudMachinesSaga(): SagaGenerator<void> {
  yield* takeLatest([remoteMachinesLoaded, cloudMachinesRefreshRequested], refresh);
  yield* takeEvery(cloudMachinesConfigureRequested, configure);
  yield* takeEvery(cloudMachinesRemoveRequested, remove);
  yield* takeEvery(cloudMachinePauseRequested, pause);
  yield* takeEvery(cloudMachineDeleteRequested, deleteSandbox);
}

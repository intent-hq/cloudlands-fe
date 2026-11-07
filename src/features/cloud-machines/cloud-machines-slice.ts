import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  CloudMachineConfigureInput,
  CloudMachineErrorData,
  CloudMachineProvider,
} from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

/** One pending operation per key: `configure`, `validate`, `remove`, or a machine id. */
export type CloudMachineOperation = 'saving' | 'testing' | 'removing' | 'pausing' | 'deleting';

/** Keys of the provider-level operations (machine operations use the machine id). */
export const CLOUD_CONFIGURE_KEY = 'configure';
export const CLOUD_VALIDATE_KEY = 'validate';
export const CLOUD_REMOVE_KEY = 'remove';

export interface CloudMachineFailure {
  message: string;
  /** Typed data of a cloud error code (`cloud-machine-unavailable`, `cloud-quota`, …). */
  cloud?: CloudMachineErrorData;
  /** `machine-in-use` from remove or pause: the agents still live there. */
  inUse?: boolean;
  /** `-32003`: only the backend owner (or the sandbox's starter) may do this. */
  forbidden?: boolean;
}

export interface CloudMachinesState {
  /** `client.hello` advertises `cloudMachines: 1` (with `remoteMachines: 1`). */
  supported: boolean;
  /** `cloudMachines.list` answered on this connection. */
  loaded: boolean;
  providers: Record<string, CloudMachineProvider>;
  /** Live sandboxes (machine rows with `cloud`), by machine id. */
  machines: Record<string, RemoteMachine>;
  /** When each row was read (ms), to advance `runningSeconds` between reads. */
  readAt: Record<string, number>;
  pending: Record<string, CloudMachineOperation>;
  failures: Record<string, CloudMachineFailure>;
  /** The provider a `validateOnly` test returned, until the form changes. */
  validated: CloudMachineProvider | null;
}

const initialCloudMachinesState: CloudMachinesState = {
  supported: false,
  loaded: false,
  providers: {},
  machines: {},
  readAt: {},
  pending: {},
  failures: {},
  validated: null,
};

export const cloudMachinesRefreshRequested = createAction('cloudMachines/refreshRequested');
export const cloudMachinesLoaded = createAction<
  [
    snapshot: {
      supported: boolean;
      providers: CloudMachineProvider[];
      machines: RemoteMachine[];
      readAt: number;
    },
  ]
>('cloudMachines/loaded');
export const cloudProviderChanged = createAction<[provider: CloudMachineProvider]>(
  'cloudMachines/providerChanged',
);
export const cloudProviderRemoved = createAction<[providerId: string]>(
  'cloudMachines/providerRemoved',
);
export const cloudMachineChanged = createAction<[machine: RemoteMachine, readAt: number]>(
  'cloudMachines/machineChanged',
);
export const cloudMachineRemoved = createAction<[machineId: string]>(
  'cloudMachines/machineRemoved',
);
/** Save (or, with `validateOnly`, only test) the E2B settings. The key is never kept. */
export const cloudMachinesConfigureRequested = createAction<
  [input: CloudMachineConfigureInput, validateOnly?: boolean]
>('cloudMachines/configureRequested');
export const cloudMachinesRemoveRequested = createAction<[stopAgents?: boolean]>(
  'cloudMachines/removeRequested',
);
export const cloudMachinePauseRequested = createAction<[machineId: string]>(
  'cloudMachines/pauseRequested',
);
/** Delete one sandbox (`cloudMachines.kill`). */
export const cloudMachineDeleteRequested = createAction<[machineId: string]>(
  'cloudMachines/deleteRequested',
);
export const cloudMachineOperationStarted = createAction<
  [key: string, operation: CloudMachineOperation]
>('cloudMachines/operationStarted');
export const cloudMachineOperationSettled = createAction<
  [key: string, failure: CloudMachineFailure | null]
>('cloudMachines/operationSettled');
export const cloudMachineValidated =
  createAction<[provider: CloudMachineProvider | null]>('cloudMachines/validated');
export const cloudMachineFailureDismissed = createAction<[key: string]>(
  'cloudMachines/failureDismissed',
);

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const cloudMachinesReducer = createReducer<CloudMachinesState>(initialCloudMachinesState);
cloudMachinesReducer.with(backendReconnected, () => initialCloudMachinesState);
cloudMachinesReducer.with(cloudMachinesLoaded, (state, { payload: [snapshot] }) => ({
  ...state,
  supported: snapshot.supported,
  loaded: snapshot.supported,
  providers: Object.fromEntries(snapshot.providers.map((provider) => [provider.id, provider])),
  machines: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, machine])),
  readAt: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, snapshot.readAt])),
}));
cloudMachinesReducer.with(cloudProviderChanged, (state, { payload: [provider] }) => ({
  ...state,
  providers: { ...state.providers, [provider.id]: provider },
}));
cloudMachinesReducer.with(cloudProviderRemoved, (state, { payload: [providerId] }) => ({
  ...state,
  providers: omit(state.providers, providerId),
  validated: null,
}));
cloudMachinesReducer.with(cloudMachineChanged, (state, { payload: [machine, readAt] }) => ({
  ...state,
  machines: { ...state.machines, [machine.id]: machine },
  readAt: { ...state.readAt, [machine.id]: readAt },
}));
cloudMachinesReducer.with(cloudMachineRemoved, (state, { payload: [machineId] }) => ({
  ...state,
  machines: omit(state.machines, machineId),
  readAt: omit(state.readAt, machineId),
  failures: omit(state.failures, machineId),
}));
cloudMachinesReducer.with(cloudMachineOperationStarted, (state, { payload: [key, operation] }) => ({
  ...state,
  pending: { ...state.pending, [key]: operation },
  failures: omit(state.failures, key),
}));
cloudMachinesReducer.with(cloudMachineOperationSettled, (state, { payload: [key, failure] }) => ({
  ...state,
  pending: omit(state.pending, key),
  failures: failure ? { ...state.failures, [key]: failure } : omit(state.failures, key),
}));
cloudMachinesReducer.with(cloudMachineValidated, (state, { payload: [provider] }) => ({
  ...state,
  validated: provider,
}));
cloudMachinesReducer.with(cloudMachineFailureDismissed, (state, { payload: [key] }) => ({
  ...state,
  failures: omit(state.failures, key),
}));

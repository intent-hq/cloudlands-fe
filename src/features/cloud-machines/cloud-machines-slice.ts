import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  DEFAULT_CLOUD_MACHINE_ID,
  type CloudMachineConfigureInput,
  type CloudMachineErrorData,
  type CloudMachineProvider,
  type CloudProviderKind,
} from '$shared/types/cloud-machines';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

/** One pending operation per key: an entry operation (below) or a machine id. */
export type CloudMachineOperation = 'saving' | 'testing' | 'removing' | 'pausing' | 'deleting';

/** Field values a preview's setup form starts from; never a real secret. */
export interface CloudFormDraft {
  name?: string;
  apiKey?: string;
  projectId?: string;
}

/** The form key of an entry that is not saved yet. */
export const NEW_CLOUD_ENTRY = 'new';
/** Keys of the entry-level operations, by entry id (or `NEW_CLOUD_ENTRY`). */
export const cloudConfigureKey = (formKey: string) => `configure:${formKey}`;
export const cloudValidateKey = (formKey: string) => `validate:${formKey}`;
export const cloudRemoveKey = (cloudMachineId: string) => `remove:${cloudMachineId}`;
/** The form a configure input belongs to: the entry it names, else a new one. */
export const cloudFormKey = (input: { cloudMachineId?: string }) =>
  input.cloudMachineId || NEW_CLOUD_ENTRY;

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
  /** `cloudMachineEntries: 1`: the backend keeps several named entries. */
  entries: boolean;
  /** `cloudMachineProviders`: the providers a new entry can use; `["e2b"]` when not listed. */
  providerKinds: CloudProviderKind[];
  /** Saved entries by id; without `entries`, only "e2b". */
  providers: Record<string, CloudMachineProvider>;
  /** Live sandboxes (machine rows with `cloud`), by machine id. */
  machines: Record<string, RemoteMachine>;
  /** When each row was read (ms), to advance `runningSeconds` between reads. */
  readAt: Record<string, number>;
  pending: Record<string, CloudMachineOperation>;
  failures: Record<string, CloudMachineFailure>;
  /** The entry a `validateOnly` test returned, by form key, until the form changes. */
  validated: Record<string, CloudMachineProvider>;
}

const initialCloudMachinesState: CloudMachinesState = {
  supported: false,
  loaded: false,
  entries: false,
  providerKinds: ['e2b'],
  providers: {},
  machines: {},
  readAt: {},
  pending: {},
  failures: {},
  validated: {},
};

export const cloudMachinesRefreshRequested = createAction('cloudMachines/refreshRequested');
export const cloudMachinesLoaded = createAction<
  [
    snapshot: {
      supported: boolean;
      entries?: boolean;
      providerKinds?: CloudProviderKind[];
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
/** Create or update (or, with `validateOnly`, only test) one entry. The key is never kept. */
export const cloudMachinesConfigureRequested = createAction<
  [input: CloudMachineConfigureInput, validateOnly?: boolean]
>('cloudMachines/configureRequested');
export const cloudMachinesRemoveRequested = createAction<
  [cloudMachineId: string, stopAgents?: boolean]
>('cloudMachines/removeRequested');
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
  createAction<[formKey: string, provider: CloudMachineProvider | null]>('cloudMachines/validated');
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
const keepEntry = (entries: boolean, id: string) => entries || id === DEFAULT_CLOUD_MACHINE_ID;

cloudMachinesReducer.with(cloudMachinesLoaded, (state, { payload: [snapshot] }) => ({
  ...state,
  supported: snapshot.supported,
  loaded: snapshot.supported,
  entries: snapshot.supported && snapshot.entries === true,
  providerKinds: snapshot.providerKinds?.length ? snapshot.providerKinds : ['e2b'],
  providers: Object.fromEntries(
    snapshot.providers
      .filter((provider) => keepEntry(snapshot.entries === true, provider.id))
      .map((provider) => [provider.id, provider]),
  ),
  machines: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, machine])),
  readAt: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, snapshot.readAt])),
}));
cloudMachinesReducer.with(cloudProviderChanged, (state, { payload: [provider] }) =>
  provider.id && keepEntry(state.entries, provider.id)
    ? { ...state, providers: { ...state.providers, [provider.id]: provider } }
    : state,
);
cloudMachinesReducer.with(cloudProviderRemoved, (state, { payload: [providerId] }) => ({
  ...state,
  providers: omit(state.providers, providerId),
  validated: omit(state.validated, providerId),
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
cloudMachinesReducer.with(cloudMachineValidated, (state, { payload: [formKey, provider] }) => ({
  ...state,
  validated: provider
    ? { ...state.validated, [formKey]: provider }
    : omit(state.validated, formKey),
}));
cloudMachinesReducer.with(cloudMachineFailureDismissed, (state, { payload: [key] }) => ({
  ...state,
  failures: omit(state.failures, key),
}));

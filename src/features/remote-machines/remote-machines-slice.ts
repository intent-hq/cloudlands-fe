import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  ExecutorBackend,
  RemoteMachine,
  RemoteMachineFailure,
  RemoteMachineListener,
} from '$shared/types/remote-machines';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { RemoteMachineOperation, RemoteMachinesState } from './remote-machines-types';

export const initialState: RemoteMachinesState = {
  supported: false,
  machines: {},
  localFingerprint: null,
  executorBackends: null,
  pending: {},
  failures: {},
};

export const remoteMachinesRefreshRequested = createAction('remoteMachines/refreshRequested');
export const remoteMachinesLoaded = createAction<
  [
    snapshot: {
      supported: boolean;
      machines: RemoteMachine[];
      localFingerprint: string | null;
      executorBackends: ExecutorBackend[] | null;
    },
  ]
>('remoteMachines/loaded');
export const remoteMachineChanged = createAction<[machine: RemoteMachine]>(
  'remoteMachines/machineChanged',
);
export const remoteMachineRemoved = createAction<[machineId: string]>(
  'remoteMachines/machineRemoved',
);
/** Owner action on a saved machine row: make it available to the current backend. */
export const remoteMachineExposeRequested = createAction<
  [connectionId: string, enableListener?: RemoteMachineListener]
>('remoteMachines/exposeRequested');
/** "Stop making available": remove from the backend, revoke on the machine. */
export const remoteMachineUnexposeRequested = createAction<
  [machineId: string, connectionId: string | null, stopAgents?: boolean]
>('remoteMachines/unexposeRequested');
/** Settings → Backends with access: revoke one backend's credential on this machine. */
export const executorRevokeRequested = createAction<[credentialId: string]>(
  'remoteMachines/executorRevokeRequested',
);
export const remoteMachineOperationStarted = createAction<
  [key: string, operation: RemoteMachineOperation]
>('remoteMachines/operationStarted');
export const remoteMachineOperationSettled = createAction<
  [key: string, failure: RemoteMachineFailure | null]
>('remoteMachines/operationSettled');
export const executorBackendRevoked = createAction<[credentialId: string]>(
  'remoteMachines/executorBackendRevoked',
);
export const remoteMachineFailureDismissed = createAction<[key: string]>(
  'remoteMachines/failureDismissed',
);

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const remoteMachinesReducer = createReducer<RemoteMachinesState>(initialState);
remoteMachinesReducer.with(backendReconnected, () => initialState);
remoteMachinesReducer.with(remoteMachinesLoaded, (state, { payload: [snapshot] }) => ({
  ...state,
  supported: snapshot.supported,
  machines: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, machine])),
  localFingerprint: snapshot.localFingerprint,
  executorBackends: snapshot.executorBackends,
}));
remoteMachinesReducer.with(remoteMachineChanged, (state, { payload: [machine] }) => ({
  ...state,
  machines: { ...state.machines, [machine.id]: machine },
}));
remoteMachinesReducer.with(remoteMachineRemoved, (state, { payload: [machineId] }) => ({
  ...state,
  machines: omit(state.machines, machineId),
}));
remoteMachinesReducer.with(
  remoteMachineOperationStarted,
  (state, { payload: [key, operation] }) => ({
    ...state,
    pending: { ...state.pending, [key]: operation },
    failures: omit(state.failures, key),
  }),
);
remoteMachinesReducer.with(remoteMachineOperationSettled, (state, { payload: [key, failure] }) => ({
  ...state,
  pending: omit(state.pending, key),
  failures: failure ? { ...state.failures, [key]: failure } : omit(state.failures, key),
}));
remoteMachinesReducer.with(executorBackendRevoked, (state, { payload: [credentialId] }) => ({
  ...state,
  executorBackends:
    state.executorBackends?.filter((backend) => backend.credentialId !== credentialId) ?? null,
}));
remoteMachinesReducer.with(remoteMachineFailureDismissed, (state, { payload: [key] }) => ({
  ...state,
  failures: omit(state.failures, key),
}));

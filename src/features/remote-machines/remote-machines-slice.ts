import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  ExecutorBackend,
  MachineOrderKey,
  MachineOrderRow,
  RemoteMachine,
  RemoteMachineFailure,
  RemoteMachineListener,
} from '$shared/types/remote-machines';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { RemoteMachineOperation, RemoteMachinesState } from './remote-machines-types';

export const initialState: RemoteMachinesState = {
  supported: false,
  initialAgentPlacement: false,
  claimInvites: false,
  machineOrder: false,
  order: null,
  orderSaving: false,
  machines: {},
  localFingerprint: null,
  executorBackends: null,
  pending: {},
  failures: {},
};

export const remoteMachinesRefreshRequested = createAction('remoteMachines/refreshRequested');
/** Ask one machine for a fresh capabilities report (`remoteMachines.refresh`). */
export const remoteMachineRefreshRequested = createAction<[machineId: string]>(
  'remoteMachines/machineRefreshRequested',
);
/** Pending key of a machine's report refresh (machine ids alone key removals). */
export const machineRefreshKey = (machineId: string) => `refresh:${machineId}`;
export const remoteMachinesLoaded = createAction<
  [
    snapshot: {
      supported: boolean;
      /** `remoteInitialAgent: 1`; absent counts as unsupported. */
      initialAgentPlacement?: boolean;
      /** Node-invite claim capability; absent counts as unsupported. */
      claimInvites?: boolean;
      /** `machineOrder: 1`; absent counts as unsupported. */
      machineOrder?: boolean;
      /** `remoteMachines.order`; null when unread or unsupported. */
      order?: MachineOrderRow[] | null;
      machines: RemoteMachine[];
      localFingerprint: string | null;
      executorBackends: ExecutorBackend[] | null;
    },
  ]
>('remoteMachines/loaded');
/** The backend's ordered machine list (`remoteMachines.order`, a reply or `remoteMachine:changed { order }`). */
export const machineOrderLoaded = createAction<[order: MachineOrderRow[]]>(
  'remoteMachines/orderLoaded',
);
/** Owner reorder: send the whole list (`remoteMachines.setOrder`). */
export const machineOrderSetRequested = createAction<[order: MachineOrderKey[]]>(
  'remoteMachines/orderSetRequested',
);
/** A `remoteMachines.setOrder` started (optimistic `order`) or settled. */
export const machineOrderSaving = createAction<[saving: boolean, order?: MachineOrderRow[]]>(
  'remoteMachines/orderSaving',
);
export const remoteMachineChanged = createAction<[machine: RemoteMachine]>(
  'remoteMachines/machineChanged',
);
export const remoteMachineRemoved = createAction<[machineId: string]>(
  'remoteMachines/machineRemoved',
);
/**
 * Owner action on a saved machine row: make it available to the current
 * backend. `confirmed` skips the confirmation when the node prompt already asked.
 */
export const remoteMachineExposeRequested = createAction<
  [connectionId: string, enableListener?: RemoteMachineListener, confirmed?: boolean]
>('remoteMachines/exposeRequested');
/** "Stop letting <backend> run agents on this machine": remove from the backend, revoke on the machine. */
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
  initialAgentPlacement: snapshot.supported && snapshot.initialAgentPlacement === true,
  claimInvites: snapshot.supported && snapshot.claimInvites === true,
  machineOrder: snapshot.supported && snapshot.machineOrder === true,
  order: snapshot.supported && snapshot.machineOrder === true ? (snapshot.order ?? null) : null,
  machines: Object.fromEntries(snapshot.machines.map((machine) => [machine.id, machine])),
  localFingerprint: snapshot.localFingerprint,
  executorBackends: snapshot.executorBackends,
}));
remoteMachinesReducer.with(machineOrderLoaded, (state, { payload: [order] }) =>
  state.machineOrder ? { ...state, order } : state,
);
remoteMachinesReducer.with(machineOrderSaving, (state, { payload: [saving, order] }) => ({
  ...state,
  orderSaving: saving,
  ...(order ? { order } : {}),
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

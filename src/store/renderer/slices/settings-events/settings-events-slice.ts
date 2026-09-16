/**
 * Settings operations and daemon change-event slice.
 *
 * Holds the typed FE action that mirrors the daemon's `settings:changed`
 * notification (PROTOCOL §6.5). The boot-hydration service and the daemon
 * events bridge both dispatch this action so panels can observe BE-owned
 * settings changes without polling. No state lives in this slice — per
 * `src/store/renderer/AGENTS.md` §8 a trigger-only slice deliberately omits
 * its reducer entry to keep the state tree free of empty branches.
 */
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  AppSettingChange,
  AppliedSettingChange,
  MutationResult,
  ServerPairingInfo,
  SettingDefinitionWithValue,
  SystemCapabilities,
  UserRuleState,
} from '$lib/client/app-client';

/**
 * Typed counterpart to the wire `settings:changed` event (§6.5). The payload
 * mirrors `data.changes` on the daemon notification — an applied
 * `{ path, value }` list with sensitive values pre-redacted by the BE. Boot
 * hydration synthesizes the action from the full `settings.list()` snapshot so
 * panels see one consistent action regardless of source. Keyed operation state
 * below lets components consume saga results through selectors.
 */
export const settingsChanged = createAction<[changes: AppliedSettingChange[]]>('settings/changed');

/** Raw daemon notification routed by daemonEventsSaga and consumed in order. */
export const settingsChangesReceived = createAction<
  [changes: AppliedSettingChange[], revision?: number]
>('settings/changesReceived');

type KeyRequest = [operationKey: string | undefined, requestId: number];
type GetSettingRequest = [path: string, operationKey: string | undefined, requestId: number];
type UpdateSettingsRequest = [
  changes: AppSettingChange[],
  operationKey: string | undefined,
  requestId: number,
];
type GetUserRuleRequest = [ruleType: string, operationKey: string | undefined, requestId: number];
type UpdateUserRuleRequest = [
  ruleType: string,
  content: string,
  enabled: boolean | undefined,
  operationKey: string | undefined,
  requestId: number,
];

let nextSettingsRequestId = 0;
const createSettingsRequestId = () => {
  nextSettingsRequestId += 1;
  return nextSettingsRequestId;
};

export const listSettingsRequested = createAsyncAction<
  [operationKey?: string],
  KeyRequest,
  SettingDefinitionWithValue[]
>('settings/list', 'settings/listRequested', (operationKey) => [
  operationKey,
  createSettingsRequestId(),
]);
export const getSettingRequested = createAsyncAction<
  [path: string, operationKey?: string],
  GetSettingRequest,
  SettingDefinitionWithValue | null
>('settings/get', 'settings/getRequested', (path, operationKey) => [
  path,
  operationKey,
  createSettingsRequestId(),
]);
export const updateSettingsRequested = createAsyncAction<
  [changes: AppSettingChange[], operationKey?: string],
  UpdateSettingsRequest,
  AppliedSettingChange[]
>('settings/update', 'settings/updateRequested', (changes, operationKey) => [
  changes,
  operationKey,
  createSettingsRequestId(),
]);
export const getUserRuleRequested = createAsyncAction<
  [ruleType: string, operationKey?: string],
  GetUserRuleRequest,
  UserRuleState | null
>('settings/getUserRule', 'settings/getUserRuleRequested', (ruleType, operationKey) => [
  ruleType,
  operationKey,
  createSettingsRequestId(),
]);
export const updateUserRuleRequested = createAsyncAction<
  [ruleType: string, content: string, enabled?: boolean, operationKey?: string],
  UpdateUserRuleRequest,
  MutationResult
>(
  'settings/updateUserRule',
  'settings/updateUserRuleRequested',
  (ruleType, content, enabled, operationKey) => [
    ruleType,
    content,
    enabled,
    operationKey,
    createSettingsRequestId(),
  ],
);
export const getServerPairingInfoRequested = createAsyncAction<
  [operationKey?: string],
  KeyRequest,
  ServerPairingInfo
>('settings/getServerPairingInfo', 'settings/getServerPairingInfoRequested', (operationKey) => [
  operationKey,
  createSettingsRequestId(),
]);
export const rotateServerTokenRequested = createAsyncAction<
  [operationKey?: string],
  KeyRequest,
  { token: string }
>('settings/rotateServerToken', 'settings/rotateServerTokenRequested', (operationKey) => [
  operationKey,
  createSettingsRequestId(),
]);
export const getSystemCapabilitiesRequested = createAsyncAction<
  [operationKey?: string],
  KeyRequest,
  SystemCapabilities
>('settings/getSystemCapabilities', 'settings/getSystemCapabilitiesRequested', (operationKey) => [
  operationKey,
  createSettingsRequestId(),
]);

export type SettingsOperation<T> = {
  status: 'idle' | 'loading' | 'success' | 'error';
  version: number;
  data: T | null;
  error: string | null;
};

type CorrelatedSettingsOperation<T> = SettingsOperation<T> & {
  requestId: number;
};

export type SettingsOperationsState = {
  lists: Record<
    string,
    CorrelatedSettingsOperation<Collection<SettingDefinitionWithValue, 'path'>>
  >;
  gets: Record<string, CorrelatedSettingsOperation<SettingDefinitionWithValue | null>>;
  updates: Record<string, CorrelatedSettingsOperation<Collection<AppliedSettingChange, 'path'>>>;
  ruleReads: Record<string, CorrelatedSettingsOperation<UserRuleState | null>>;
  ruleWrites: Record<string, CorrelatedSettingsOperation<MutationResult>>;
  pairingReads: Record<string, CorrelatedSettingsOperation<ServerPairingInfo>>;
  tokenRotations: Record<string, CorrelatedSettingsOperation<{ token: string }>>;
  capabilityReads: Record<string, CorrelatedSettingsOperation<SystemCapabilities>>;
};

export const initialState: SettingsOperationsState = {
  lists: {},
  gets: {},
  updates: {},
  ruleReads: {},
  ruleWrites: {},
  pairingReads: {},
  tokenRotations: {},
  capabilityReads: {},
};

const operationKey = (key?: string) => key ?? 'default';
const loading = <T>(
  current: CorrelatedSettingsOperation<T> | undefined,
  requestId: number,
): CorrelatedSettingsOperation<T> => ({
  status: 'loading',
  version: (current?.version ?? 0) + 1,
  data: current?.data ?? null,
  error: null,
  requestId,
});
const success = <T>(
  current: CorrelatedSettingsOperation<T>,
  data: T,
): CorrelatedSettingsOperation<T> => ({
  status: 'success',
  version: current.version,
  data,
  error: null,
  requestId: current.requestId,
});
const failure = <T>(
  current: CorrelatedSettingsOperation<T>,
  error: Error,
): CorrelatedSettingsOperation<T> => ({
  status: 'error',
  version: current.version,
  data: current.data,
  error: error.message,
  requestId: current.requestId,
});
const isCurrentRequest = <T>(
  current: CorrelatedSettingsOperation<T> | undefined,
  requestId: number,
): current is CorrelatedSettingsOperation<T> => current?.requestId === requestId;

export const settingsOperationsReducer = createReducer<SettingsOperationsState>(initialState);

settingsOperationsReducer.with(listSettingsRequested, (state, { payload: [key, requestId] }) => {
  const id = operationKey(key);
  return { ...state, lists: { ...state.lists, [id]: loading(state.lists[id], requestId) } };
});
settingsOperationsReducer.with(listSettingsRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.lists[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    lists: {
      ...state.lists,
      [id]: success(current, createCollection('path', payload.response)),
    },
  };
});
settingsOperationsReducer.with(listSettingsRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.lists[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return { ...state, lists: { ...state.lists, [id]: failure(current, payload.error) } };
});

settingsOperationsReducer.with(getSettingRequested, (state, { payload: [, key, requestId] }) => {
  const id = operationKey(key);
  return { ...state, gets: { ...state.gets, [id]: loading(state.gets[id], requestId) } };
});
settingsOperationsReducer.with(getSettingRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.gets[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return { ...state, gets: { ...state.gets, [id]: success(current, payload.response) } };
});
settingsOperationsReducer.with(getSettingRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.gets[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return { ...state, gets: { ...state.gets, [id]: failure(current, payload.error) } };
});

settingsOperationsReducer.with(
  updateSettingsRequested,
  (state, { payload: [, key, requestId] }) => {
    const id = operationKey(key);
    return { ...state, updates: { ...state.updates, [id]: loading(state.updates[id], requestId) } };
  },
);
settingsOperationsReducer.with(updateSettingsRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.updates[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return {
    ...state,
    updates: {
      ...state.updates,
      [id]: success(current, createCollection('path', payload.response)),
    },
  };
});
settingsOperationsReducer.with(updateSettingsRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.updates[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return {
    ...state,
    updates: { ...state.updates, [id]: failure(current, payload.error) },
  };
});

settingsOperationsReducer.with(getUserRuleRequested, (state, { payload: [, key, requestId] }) => {
  const id = operationKey(key);
  return {
    ...state,
    ruleReads: { ...state.ruleReads, [id]: loading(state.ruleReads[id], requestId) },
  };
});
settingsOperationsReducer.with(getUserRuleRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.ruleReads[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return {
    ...state,
    ruleReads: { ...state.ruleReads, [id]: success(current, payload.response) },
  };
});
settingsOperationsReducer.with(getUserRuleRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  const current = state.ruleReads[id];
  if (!isCurrentRequest(current, payload.request[2])) return state;
  return {
    ...state,
    ruleReads: { ...state.ruleReads, [id]: failure(current, payload.error) },
  };
});

settingsOperationsReducer.with(
  updateUserRuleRequested,
  (state, { payload: [, , , key, requestId] }) => {
    const id = operationKey(key);
    return {
      ...state,
      ruleWrites: { ...state.ruleWrites, [id]: loading(state.ruleWrites[id], requestId) },
    };
  },
);
settingsOperationsReducer.with(updateUserRuleRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[3]);
  const current = state.ruleWrites[id];
  if (!isCurrentRequest(current, payload.request[4])) return state;
  return {
    ...state,
    ruleWrites: { ...state.ruleWrites, [id]: success(current, payload.response) },
  };
});
settingsOperationsReducer.with(updateUserRuleRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[3]);
  const current = state.ruleWrites[id];
  if (!isCurrentRequest(current, payload.request[4])) return state;
  return {
    ...state,
    ruleWrites: { ...state.ruleWrites, [id]: failure(current, payload.error) },
  };
});

settingsOperationsReducer.with(
  getServerPairingInfoRequested,
  (state, { payload: [key, requestId] }) => {
    const id = operationKey(key);
    return {
      ...state,
      pairingReads: { ...state.pairingReads, [id]: loading(state.pairingReads[id], requestId) },
    };
  },
);
settingsOperationsReducer.with(getServerPairingInfoRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.pairingReads[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    pairingReads: {
      ...state.pairingReads,
      [id]: success(current, payload.response),
    },
  };
});
settingsOperationsReducer.with(getServerPairingInfoRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.pairingReads[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    pairingReads: { ...state.pairingReads, [id]: failure(current, payload.error) },
  };
});

settingsOperationsReducer.with(
  rotateServerTokenRequested,
  (state, { payload: [key, requestId] }) => {
    const id = operationKey(key);
    return {
      ...state,
      tokenRotations: {
        ...state.tokenRotations,
        [id]: loading(state.tokenRotations[id], requestId),
      },
    };
  },
);
settingsOperationsReducer.with(rotateServerTokenRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.tokenRotations[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    tokenRotations: {
      ...state.tokenRotations,
      [id]: success(current, payload.response),
    },
  };
});
settingsOperationsReducer.with(rotateServerTokenRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.tokenRotations[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    tokenRotations: {
      ...state.tokenRotations,
      [id]: failure(current, payload.error),
    },
  };
});

settingsOperationsReducer.with(
  getSystemCapabilitiesRequested,
  (state, { payload: [key, requestId] }) => {
    const id = operationKey(key);
    return {
      ...state,
      capabilityReads: {
        ...state.capabilityReads,
        [id]: loading(state.capabilityReads[id], requestId),
      },
    };
  },
);
settingsOperationsReducer.with(getSystemCapabilitiesRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.capabilityReads[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    capabilityReads: {
      ...state.capabilityReads,
      [id]: success(current, payload.response),
    },
  };
});
settingsOperationsReducer.with(getSystemCapabilitiesRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  const current = state.capabilityReads[id];
  if (!isCurrentRequest(current, payload.request[1])) return state;
  return {
    ...state,
    capabilityReads: {
      ...state.capabilityReads,
      [id]: failure(current, payload.error),
    },
  };
});

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

export const listSettingsRequested = createAsyncAction<
  [operationKey?: string],
  SettingDefinitionWithValue[]
>('settings/list', 'settings/listRequested');
export const getSettingRequested = createAsyncAction<
  [path: string, operationKey?: string],
  SettingDefinitionWithValue | null
>('settings/get', 'settings/getRequested');
export const updateSettingsRequested = createAsyncAction<
  [changes: AppSettingChange[], operationKey?: string],
  AppliedSettingChange[]
>('settings/update', 'settings/updateRequested');
export const getUserRuleRequested = createAsyncAction<
  [ruleType: string, operationKey?: string],
  UserRuleState | null
>('settings/getUserRule', 'settings/getUserRuleRequested');
export const updateUserRuleRequested = createAsyncAction<
  [ruleType: string, content: string, enabled?: boolean, operationKey?: string],
  MutationResult
>('settings/updateUserRule', 'settings/updateUserRuleRequested');
export const getServerPairingInfoRequested = createAsyncAction<
  [operationKey?: string],
  ServerPairingInfo
>('settings/getServerPairingInfo', 'settings/getServerPairingInfoRequested');
export const rotateServerTokenRequested = createAsyncAction<
  [operationKey?: string],
  { token: string }
>('settings/rotateServerToken', 'settings/rotateServerTokenRequested');
export const getSystemCapabilitiesRequested = createAsyncAction<
  [operationKey?: string],
  SystemCapabilities
>('settings/getSystemCapabilities', 'settings/getSystemCapabilitiesRequested');

export type SettingsOperation<T> = {
  status: 'idle' | 'loading' | 'success' | 'error';
  version: number;
  data: T | null;
  error: string | null;
};

export type SettingsOperationsState = {
  lists: Record<string, SettingsOperation<Collection<SettingDefinitionWithValue, 'path'>>>;
  gets: Record<string, SettingsOperation<SettingDefinitionWithValue | null>>;
  updates: Record<string, SettingsOperation<Collection<AppliedSettingChange, 'path'>>>;
  ruleReads: Record<string, SettingsOperation<UserRuleState | null>>;
  ruleWrites: Record<string, SettingsOperation<MutationResult>>;
  pairingReads: Record<string, SettingsOperation<ServerPairingInfo>>;
  tokenRotations: Record<string, SettingsOperation<{ token: string }>>;
  capabilityReads: Record<string, SettingsOperation<SystemCapabilities>>;
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
const loading = <T>(current?: SettingsOperation<T>): SettingsOperation<T> => ({
  status: 'loading',
  version: (current?.version ?? 0) + 1,
  data: current?.data ?? null,
  error: null,
});
const success = <T>(current: SettingsOperation<T> | undefined, data: T): SettingsOperation<T> => ({
  status: 'success',
  version: current?.version ?? 1,
  data,
  error: null,
});
const failure = <T>(
  current: SettingsOperation<T> | undefined,
  error: Error,
): SettingsOperation<T> => ({
  status: 'error',
  version: current?.version ?? 1,
  data: current?.data ?? null,
  error: error.message,
});

export const settingsOperationsReducer = createReducer<SettingsOperationsState>(initialState);

settingsOperationsReducer.with(listSettingsRequested, (state, { payload: [key] }) => {
  const id = operationKey(key);
  return { ...state, lists: { ...state.lists, [id]: loading(state.lists[id]) } };
});
settingsOperationsReducer.with(listSettingsRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    lists: {
      ...state.lists,
      [id]: success(state.lists[id], createCollection('path', payload.response)),
    },
  };
});
settingsOperationsReducer.with(listSettingsRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return { ...state, lists: { ...state.lists, [id]: failure(state.lists[id], payload.error) } };
});

settingsOperationsReducer.with(getSettingRequested, (state, { payload: [, key] }) => {
  const id = operationKey(key);
  return { ...state, gets: { ...state.gets, [id]: loading(state.gets[id]) } };
});
settingsOperationsReducer.with(getSettingRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return { ...state, gets: { ...state.gets, [id]: success(state.gets[id], payload.response) } };
});
settingsOperationsReducer.with(getSettingRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return { ...state, gets: { ...state.gets, [id]: failure(state.gets[id], payload.error) } };
});

settingsOperationsReducer.with(updateSettingsRequested, (state, { payload: [, key] }) => {
  const id = operationKey(key);
  return { ...state, updates: { ...state.updates, [id]: loading(state.updates[id]) } };
});
settingsOperationsReducer.with(updateSettingsRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return {
    ...state,
    updates: {
      ...state.updates,
      [id]: success(state.updates[id], createCollection('path', payload.response)),
    },
  };
});
settingsOperationsReducer.with(updateSettingsRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return {
    ...state,
    updates: { ...state.updates, [id]: failure(state.updates[id], payload.error) },
  };
});

settingsOperationsReducer.with(getUserRuleRequested, (state, { payload: [, key] }) => {
  const id = operationKey(key);
  return { ...state, ruleReads: { ...state.ruleReads, [id]: loading(state.ruleReads[id]) } };
});
settingsOperationsReducer.with(getUserRuleRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return {
    ...state,
    ruleReads: { ...state.ruleReads, [id]: success(state.ruleReads[id], payload.response) },
  };
});
settingsOperationsReducer.with(getUserRuleRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[1]);
  return {
    ...state,
    ruleReads: { ...state.ruleReads, [id]: failure(state.ruleReads[id], payload.error) },
  };
});

settingsOperationsReducer.with(updateUserRuleRequested, (state, { payload: [, , , key] }) => {
  const id = operationKey(key);
  return { ...state, ruleWrites: { ...state.ruleWrites, [id]: loading(state.ruleWrites[id]) } };
});
settingsOperationsReducer.with(updateUserRuleRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[3]);
  return {
    ...state,
    ruleWrites: { ...state.ruleWrites, [id]: success(state.ruleWrites[id], payload.response) },
  };
});
settingsOperationsReducer.with(updateUserRuleRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[3]);
  return {
    ...state,
    ruleWrites: { ...state.ruleWrites, [id]: failure(state.ruleWrites[id], payload.error) },
  };
});

settingsOperationsReducer.with(getServerPairingInfoRequested, (state, { payload: [key] }) => {
  const id = operationKey(key);
  return {
    ...state,
    pairingReads: { ...state.pairingReads, [id]: loading(state.pairingReads[id]) },
  };
});
settingsOperationsReducer.with(getServerPairingInfoRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    pairingReads: {
      ...state.pairingReads,
      [id]: success(state.pairingReads[id], payload.response),
    },
  };
});
settingsOperationsReducer.with(getServerPairingInfoRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    pairingReads: { ...state.pairingReads, [id]: failure(state.pairingReads[id], payload.error) },
  };
});

settingsOperationsReducer.with(rotateServerTokenRequested, (state, { payload: [key] }) => {
  const id = operationKey(key);
  return {
    ...state,
    tokenRotations: { ...state.tokenRotations, [id]: loading(state.tokenRotations[id]) },
  };
});
settingsOperationsReducer.with(rotateServerTokenRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    tokenRotations: {
      ...state.tokenRotations,
      [id]: success(state.tokenRotations[id], payload.response),
    },
  };
});
settingsOperationsReducer.with(rotateServerTokenRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    tokenRotations: {
      ...state.tokenRotations,
      [id]: failure(state.tokenRotations[id], payload.error),
    },
  };
});

settingsOperationsReducer.with(getSystemCapabilitiesRequested, (state, { payload: [key] }) => {
  const id = operationKey(key);
  return {
    ...state,
    capabilityReads: { ...state.capabilityReads, [id]: loading(state.capabilityReads[id]) },
  };
});
settingsOperationsReducer.with(getSystemCapabilitiesRequested.success, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    capabilityReads: {
      ...state.capabilityReads,
      [id]: success(state.capabilityReads[id], payload.response),
    },
  };
});
settingsOperationsReducer.with(getSystemCapabilitiesRequested.failure, (state, { payload }) => {
  const id = operationKey(payload.request[0]);
  return {
    ...state,
    capabilityReads: {
      ...state.capabilityReads,
      [id]: failure(state.capabilityReads[id], payload.error),
    },
  };
});

import { store } from '../../store';
import type { SettingsOperation } from './settings-events-slice';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { AppliedSettingChange } from '$lib/client/app-client';

const EMPTY_OPERATION: SettingsOperation<never> = {
  status: 'idle',
  version: 0,
  data: null,
  error: null,
};

const selectOperation = <T>(
  entries: Record<string, SettingsOperation<T>>,
  key: string,
): SettingsOperation<T> => entries[key] ?? EMPTY_OPERATION;

const materializeCollectionOperation = <T extends object, K extends keyof T & string>(
  operation: SettingsOperation<Collection<T, K>> | undefined,
): SettingsOperation<T[]> =>
  operation
    ? { ...operation, data: operation.data ? getItems(operation.data) : null }
    : EMPTY_OPERATION;

export const selectSettingsListOperation = store.createSelector((state, key: string) =>
  materializeCollectionOperation(state.settingsOperations.lists[key]),
);
export const selectSettingGetOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.gets, key),
);
export const selectSettingsUpdateOperation = store.createSelector((state, key: string) =>
  materializeCollectionOperation(state.settingsOperations.updates[key]),
);
export const selectSettingsUpdateOperations = store.createSelector(
  (state): Record<string, SettingsOperation<AppliedSettingChange[]>> =>
    Object.fromEntries(
      Object.entries(state.settingsOperations.updates).map(([key, operation]) => [
        key,
        materializeCollectionOperation(operation),
      ]),
    ),
);
export const selectUserRuleOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.ruleReads, key),
);
export const selectUserRuleUpdateOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.ruleWrites, key),
);
export const selectServerPairingOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.pairingReads, key),
);
export const selectTokenRotationOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.tokenRotations, key),
);
export const selectSystemCapabilitiesOperation = store.createSelector((state, key: string) =>
  selectOperation(state.settingsOperations.capabilityReads, key),
);

import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import {
  initialState,
  listSettingsRequested,
  settingsOperationsReducer,
  updateSettingsRequested,
} from './settings-events-slice';
import {
  selectSettingsListOperation,
  selectSettingsUpdateOperation,
  selectSettingsUpdateOperations,
} from './settings-events-selectors';

const KEY = 'component:operation';
const listed = [
  {
    path: 'feature.first',
    label: 'First',
    description: 'First feature',
    category: 'features',
    type: 'boolean' as const,
    value: true,
  },
  {
    path: 'feature.second',
    label: 'Second',
    description: 'Second feature',
    category: 'features',
    type: 'boolean' as const,
    value: false,
  },
];
const applied = [
  { path: 'feature.first', value: true },
  { path: 'feature.second', value: false },
];

const storeState = (settingsOperations: typeof initialState) =>
  ({ settingsOperations }) as unknown as StoreState;

describe('settings operation selectors', () => {
  it('materializes ordered settings.list data from normalized state', () => {
    const request = listSettingsRequested(KEY);
    const loading = settingsOperationsReducer(initialState, request);
    const succeeded = settingsOperationsReducer(loading, request.success(listed));

    expect(selectSettingsListOperation.select(storeState(succeeded), KEY)).toEqual({
      status: 'success',
      version: 1,
      data: listed,
      error: null,
    });
  });

  it('materializes keyed settings.update data from normalized state', () => {
    const request = updateSettingsRequested(applied, KEY);
    const loading = settingsOperationsReducer(initialState, request);
    const succeeded = settingsOperationsReducer(loading, request.success(applied));
    const state = storeState(succeeded);

    expect(selectSettingsUpdateOperation.select(state, KEY).data).toEqual(applied);
    expect(selectSettingsUpdateOperations.select(state)[KEY]?.data).toEqual(applied);
  });

  it('returns the idle operation for missing keys', () => {
    expect(selectSettingsListOperation.select(storeState(initialState), 'missing')).toEqual({
      status: 'idle',
      version: 0,
      data: null,
      error: null,
    });
  });
});

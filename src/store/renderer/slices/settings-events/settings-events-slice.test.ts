import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

import {
  getServerPairingInfoRequested,
  getSettingRequested,
  getSystemCapabilitiesRequested,
  getUserRuleRequested,
  initialState,
  listSettingsRequested,
  rotateServerTokenRequested,
  settingsOperationsReducer,
  updateSettingsRequested,
  updateUserRuleRequested,
  type SettingsOperationsState,
} from './settings-events-slice';

const KEY = 'component:operation';

const cases: Array<{
  name: string;
  create: () => any;
  select: (state: SettingsOperationsState) => any;
  response: unknown;
  storedResponse?: (response: any) => unknown;
}> = [
  {
    name: 'settings list',
    create: () => listSettingsRequested(KEY),
    select: (state) => state.lists[KEY],
    response: [{ path: 'test.path', value: true }],
    storedResponse: (response) => createCollection('path', response),
  },
  {
    name: 'setting read',
    create: () => getSettingRequested('test.path', KEY),
    select: (state) => state.gets[KEY],
    response: { path: 'test.path', value: true },
  },
  {
    name: 'settings update',
    create: () => updateSettingsRequested([{ path: 'test.path', value: true }], KEY),
    select: (state) => state.updates[KEY],
    response: [{ path: 'test.path', value: true }],
    storedResponse: (response) => createCollection('path', response),
  },
  {
    name: 'rule read',
    create: () => getUserRuleRequested('user', KEY),
    select: (state) => state.ruleReads[KEY],
    response: { enabled: true, content: 'Rule', updatedAt: 1 },
  },
  {
    name: 'rule update',
    create: () => updateUserRuleRequested('user', 'Rule', undefined, KEY),
    select: (state) => state.ruleWrites[KEY],
    response: { success: true },
  },
  {
    name: 'pairing read',
    create: () => getServerPairingInfoRequested(KEY),
    select: (state) => state.pairingReads[KEY],
    response: { token: 'test', port: 5181, path: '/ws', localIps: [], hostname: 'host' },
  },
  {
    name: 'token rotation',
    create: () => rotateServerTokenRequested(KEY),
    select: (state) => state.tokenRotations[KEY],
    response: { token: 'rotated' },
  },
  {
    name: 'capability read',
    create: () => getSystemCapabilitiesRequested(KEY),
    select: (state) => state.capabilityReads[KEY],
    response: { cowSupported: true },
  },
];

describe('settingsOperationsReducer', () => {
  it('starts with empty keyed operation maps', () => {
    expect(settingsOperationsReducer(undefined, { type: 'init' })).toEqual(initialState);
  });

  it.each(cases)(
    'tracks keyed $name request, success, and failure',
    ({ create, select, response, storedResponse }) => {
      const first = create();
      const loading = settingsOperationsReducer(initialState, first);
      expect(select(loading)).toMatchObject({ status: 'loading', version: 1, data: null });

      const succeeded = settingsOperationsReducer(loading, first.success(response));
      expect(select(succeeded)).toEqual({
        status: 'success',
        version: 1,
        data: storedResponse?.(response) ?? response,
        error: null,
      });

      const second = create();
      void second.promise.catch(() => {});
      const reloading = settingsOperationsReducer(succeeded, second);
      const failed = settingsOperationsReducer(reloading, second.failure(new Error('failed')));
      expect(select(failed)).toEqual({
        status: 'error',
        version: 2,
        data: storedResponse?.(response) ?? response,
        error: 'failed',
      });
    },
  );
});

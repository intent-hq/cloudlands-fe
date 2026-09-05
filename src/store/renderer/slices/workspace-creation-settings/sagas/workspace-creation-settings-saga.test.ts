import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.error, warn: mocks.warn }),
}));

import { initialState } from '../workspace-creation-settings-slice';
import {
  hydrateWorkspaceCreationSettingsWorker,
  persistWorkspaceCreationSettingsWorker,
} from './workspace-creation-settings-saga';

function state() {
  return {
    workspaceCreationSettings: {
      ...initialState,
      hydrated: true,
      lastSelectedRepo: { path: '/repo', type: 'local' as const },
      branchByRepo: { '/repo': 'main' },
      defaultParentPath: '/parent',
      recentRepos: createCollection('path', [
        { path: '/repo', type: 'local' as const, name: 'repo' },
      ]),
      remoteSetups: createCollection('id', []),
    },
  };
}

describe('workspaceCreationSettingsSaga workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue([]);
  });

  it('hydrates the neutral daemon settings bag', async () => {
    mocks.get.mockResolvedValue({
      definition: { path: 'workspaceCreationSettings.state', type: 'object' },
      value: {
        lastSelectedRepo: { path: '/repo', type: 'local' },
        branchByRepo: { '/repo': 'main', bad: 7 },
      },
    });
    const dispatched: unknown[] = [];
    await runSaga(
      { dispatch: (action) => dispatched.push(action) },
      hydrateWorkspaceCreationSettingsWorker,
    ).toPromise();
    expect(mocks.get).toHaveBeenCalledWith('workspaceCreationSettings.state');
    expect(dispatched).toEqual([
      expect.objectContaining({
        payload: [expect.objectContaining({ branchByRepo: { '/repo': 'main' } })],
      }),
    ]);
  });

  it('persists only shared creation settings', async () => {
    await runSaga({ getState: state }, persistWorkspaceCreationSettingsWorker).toPromise();
    expect(mocks.update).toHaveBeenCalledWith([
      {
        path: 'workspaceCreationSettings.state',
        value: {
          lastSelectedRepo: { path: '/repo', type: 'local' },
          branchByRepo: { '/repo': 'main' },
          defaultParentPath: '/parent',
          recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
          remoteSetups: [],
        },
      },
    ]);
  });
});

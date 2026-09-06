import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.error, warn: mocks.warn, info: mocks.info }),
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

  it('uses the new settings bag without reading the legacy key', async () => {
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
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(dispatched).toEqual([
      expect.objectContaining({
        payload: [expect.objectContaining({ branchByRepo: { '/repo': 'main' } })],
      }),
    ]);
  });

  it('migrates the tolerant legacy settings bag into the new key', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path === 'workspaceCreationSettings.state'
        ? { value: {} }
        : {
            value: {
              compactFormState: { repoPath: '/retired' },
              lastSelectedRepo: { path: '/repo', type: 'local' },
              branchByRepo: { '/repo': 'main', bad: 7 },
              defaultParentPath: '/parent',
              recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }, 'bad'],
              remoteSetups: [{ id: 'remote', name: 'Remote' }, null],
            },
          },
    );
    const dispatch = vi.fn();

    await runSaga({ dispatch }, hydrateWorkspaceCreationSettingsWorker).toPromise();

    const migrated = {
      lastSelectedRepo: { path: '/repo', type: 'local' },
      branchByRepo: { '/repo': 'main' },
      defaultParentPath: '/parent',
      recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
      remoteSetups: [{ id: 'remote', name: 'Remote' }],
    };
    expect(mocks.get.mock.calls).toEqual([
      ['workspaceCreationSettings.state'],
      ['workspaceInitializer.state'],
    ]);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: [migrated] }));
    expect(mocks.update).toHaveBeenCalledWith([
      { path: 'workspaceCreationSettings.state', value: migrated },
    ]);
    expect(mocks.info).toHaveBeenCalledOnce();
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

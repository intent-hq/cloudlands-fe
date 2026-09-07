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

  it('uses the daemon-registered settings bag without reading the legacy FE key', async () => {
    mocks.get.mockResolvedValue({
      definition: { path: 'workspaceInitializer.state', type: 'object' },
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
    expect(mocks.get).toHaveBeenCalledWith('workspaceInitializer.state');
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
      path === 'workspaceInitializer.state'
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
      ['workspaceInitializer.state'],
      ['workspaceCreationSettings.state'],
    ]);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: [migrated] }));
    expect(mocks.update).toHaveBeenCalledWith([
      { path: 'workspaceInitializer.state', value: migrated },
    ]);
    expect(mocks.info).toHaveBeenCalledOnce();
  });

  it('hydrates defaults when the daemon rejects the unregistered legacy key', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === 'workspaceInitializer.state') return { value: {} };
      throw new Error('unknown setting');
    });
    const dispatch = vi.fn();

    const hydrated = await runSaga(
      { dispatch },
      hydrateWorkspaceCreationSettingsWorker,
    ).toPromise();

    expect(hydrated).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: [expect.objectContaining({ lastSelectedRepo: null })] }),
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('persists only shared creation settings', async () => {
    await runSaga({ getState: state }, persistWorkspaceCreationSettingsWorker).toPromise();
    expect(mocks.update).toHaveBeenCalledWith([
      {
        path: 'workspaceInitializer.state',
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

import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  getJSON: vi.fn(),
  getItem: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: mocks.get, update: mocks.update } },
}));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getJSON: mocks.getJSON,
    getItem: mocks.getItem,
    getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
    setJSON: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    keysWithPrefix: vi.fn(),
  },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.error, warn: mocks.warn }),
}));

import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
  hydrateWorkspaceInitializer,
  initialState,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerRecentRepos,
  workspaceInitializerReducer,
} from '../workspace-initializer-slice';
import type {
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerState,
} from '../workspace-initializer-types';
import {
  hydrateWorkspaceInitializerWorker,
  persistWorkspaceInitializerWorker,
  workspaceInitializerSaga,
} from './workspace-initializer-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function populatedState() {
  return {
    workspaceInitializer: {
      ...initialState,
      hydrated: true,
      compactFormState: { repoPath: '/compact' },
      onboardingFormState: {
        projectSelection: { type: 'local' as const, repoPath: '/draft' },
        step: 'project' as const,
      },
      lastSelectedRepo: { path: '/repo', type: 'local' as const },
      branchByRepo: { '/repo': 'main' },
      defaultParentPath: '/parent',
      recentRepos: createCollection('path', [
        { path: '/repo', type: 'local' as const, name: 'repo' },
      ]),
      remoteSetups: createCollection('id', [
        {
          id: 'remote-1',
          name: 'Remote',
          host: 'example.com',
          port: 22,
          username: 'user',
          workspacePath: '/workspace',
        },
      ]),
      lastSubmittedAgent: { selectedModel: 'sonnet' },
    },
  };
}

describe('workspaceInitializerSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getJSON.mockReturnValue(undefined);
    mocks.getItem.mockReturnValue(null);
    mocks.update.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('hydrates the exact tolerant daemon bag from workspaceInitializer.state', async () => {
    // Legacy persisted setup-script fields must be stripped on hydration:
    // the setup script is session-local now (last-used lives in localStorage).
    mocks.get.mockResolvedValue({
      definition: { path: 'workspaceInitializer.state', type: 'object' },
      value: {
        compactFormState: {
          repoPath: '/compact',
          setupScript: 'echo legacy',
          setupScriptName: 'Legacy',
          isCustomSetupScript: true,
          showSetupScript: true,
        },
        onboardingFormState: {
          projectSelection: null,
          step: 'project',
          setupScript: 'echo legacy',
          setupScriptName: 'Legacy',
          isCustomSetupScript: true,
        },
        lastSelectedRepo: { path: '/repo', type: 'local' },
        branchByRepo: { '/repo': 'main', bad: 7 },
        defaultParentPath: '/parent',
        recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }, 'bad'],
        remoteSetups: [{ id: 'remote', name: 'Remote' }, null],
        lastSubmittedAgent: { selectedModel: 'sonnet' },
      },
    });
    const dispatch = vi.fn();
    const result = await runSaga(
      { dispatch, getState: () => ({}) },
      hydrateWorkspaceInitializerWorker,
    ).toPromise();

    expect(mocks.get.mock.calls).toEqual([['workspaceInitializer.state']]);
    expect(dispatch.mock.calls).toEqual([
      [
        hydrateWorkspaceInitializer({
          compactFormState: { repoPath: '/compact' },
          onboardingFormState: { projectSelection: null, step: 'project' },
          lastSelectedRepo: { path: '/repo', type: 'local' },
          branchByRepo: { '/repo': 'main' },
          defaultParentPath: '/parent',
          recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
          remoteSetups: [{ id: 'remote', name: 'Remote' }],
          lastSubmittedAgent: { selectedModel: 'sonnet' },
        }),
      ],
    ]);
    expect(result).toBe(true);
  });

  it('migrates every legacy storage key into one exact daemon update', async () => {
    mocks.get.mockResolvedValue({ value: {} });
    const values: Record<string, unknown> = {
      'compact-workspace-initializer-state': { repoPath: '/compact' },
      'onboarding-form-state': { projectSelection: null, step: 'project' },
      'workspace-initializer-last-repo': { path: '/repo', type: 'local' },
      'workspace-initializer-branch-by-repo': { '/repo': 'main', bad: 1 },
      'workspace-initializer-recent-repos': [{ path: '/repo', type: 'local', name: 'repo' }],
      'remote-setups': [{ id: 'remote', name: 'Remote' }],
      'workspace-initializer-last-agent': { selectedModel: 'sonnet' },
    };
    mocks.getJSON.mockImplementation((key: string) => values[key]);
    mocks.getItem.mockReturnValue('/parent');
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({}) },
      hydrateWorkspaceInitializerWorker,
    ).toPromise();
    const migrated: WorkspaceInitializerHydrationState = {
      compactFormState: { repoPath: '/compact' },
      onboardingFormState: { projectSelection: null, step: 'project' },
      lastSelectedRepo: { path: '/repo', type: 'local' },
      branchByRepo: { '/repo': 'main' },
      defaultParentPath: '/parent',
      recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
      remoteSetups: [{ id: 'remote', name: 'Remote' } as never],
      lastSubmittedAgent: { selectedModel: 'sonnet' },
    };

    expect(dispatch.mock.calls).toEqual([[hydrateWorkspaceInitializer(migrated)]]);
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'workspaceInitializer.state', value: migrated }]],
    ]);
  });

  it('dispatches defaults and never writes when hydration fails', async () => {
    mocks.get.mockResolvedValue(null);
    const dispatch = vi.fn();
    const result = await runSaga(
      { dispatch, getState: () => ({}) },
      hydrateWorkspaceInitializerWorker,
    ).toPromise();

    expect(dispatch.mock.calls).toEqual([
      [
        hydrateWorkspaceInitializer({
          compactFormState: null,
          onboardingFormState: null,
          lastSelectedRepo: null,
        }),
      ],
    ]);
    expect(mocks.update.mock.calls).toEqual([]);
    expect(result).toBe(false);
  });

  it('persists an exact full snapshot and swallows update failures', async () => {
    const state = populatedState();
    mocks.update.mockRejectedValue(new Error('offline'));
    await runSaga(
      { dispatch: vi.fn(), getState: () => state },
      persistWorkspaceInitializerWorker,
    ).toPromise();

    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: { repoPath: '/compact' },
              onboardingFormState: {
                projectSelection: { type: 'local', repoPath: '/draft' },
                step: 'project',
              },
              lastSelectedRepo: { path: '/repo', type: 'local' },
              branchByRepo: { '/repo': 'main' },
              defaultParentPath: '/parent',
              recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
              remoteSetups: [
                {
                  id: 'remote-1',
                  name: 'Remote',
                  host: 'example.com',
                  port: 22,
                  username: 'user',
                  workspacePath: '/workspace',
                },
              ],
              lastSubmittedAgent: { selectedModel: 'sonnet' },
            },
          },
        ],
      ],
    ]);
    expect(mocks.error.mock.calls).toHaveLength(1);
  });

  it('warns once and persists a JSON-sanitized bag when structured cloning fails', async () => {
    const cloneError = new Error('not cloneable');
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
      throw cloneError;
    });
    const state = populatedState();
    await runSaga(
      { dispatch: vi.fn(), getState: () => state },
      persistWorkspaceInitializerWorker,
    ).toPromise();
    cloneSpy.mockRestore();

    expect(mocks.warn.mock.calls).toEqual([
      [
        'Sanitized non-structured-cloneable workspaceInitializer.state bag before persisting; ' +
          'a non-serializable value (e.g. a $state proxy) reached the store',
        { error: cloneError },
      ],
    ]);
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: { repoPath: '/compact' },
              onboardingFormState: {
                projectSelection: { type: 'local', repoPath: '/draft' },
                step: 'project',
              },
              lastSelectedRepo: { path: '/repo', type: 'local' },
              branchByRepo: { '/repo': 'main' },
              defaultParentPath: '/parent',
              recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
              remoteSetups: [
                {
                  id: 'remote-1',
                  name: 'Remote',
                  host: 'example.com',
                  port: 22,
                  username: 'user',
                  workspacePath: '/workspace',
                },
              ],
              lastSubmittedAgent: { selectedModel: 'sonnet' },
            },
          },
        ],
      ],
    ]);
    expect(mocks.error.mock.calls).toEqual([]);
  });

  it('skips persistence when a non-cloneable bag cannot be JSON-sanitized', async () => {
    const cloneError = new Error('not cloneable');
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => {
      throw cloneError;
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const state = populatedState();
    state.workspaceInitializer.branchByRepo = circular as Record<string, string>;
    await runSaga(
      { dispatch: vi.fn(), getState: () => state },
      persistWorkspaceInitializerWorker,
    ).toPromise();
    cloneSpy.mockRestore();
    const loggedError = mocks.error.mock.calls[0]?.[1]?.error;

    expect(mocks.update.mock.calls).toEqual([]);
    expect(loggedError).toBeInstanceOf(TypeError);
    expect(mocks.error.mock.calls).toEqual([
      ['Cannot sanitize workspaceInitializer.state bag; skipping persist', { error: loggedError }],
    ]);
  });

  it('coalesces pre-hydration mutations and flushes the hydrated bag once', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockReturnValue(new Promise((done) => (resolve = done)));
    const channel = stdChannel();
    let slice: WorkspaceInitializerState = initialState;
    const dispatch = vi.fn((action) => {
      slice = workspaceInitializerReducer(slice, action);
      channel.put(action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ workspaceInitializer: slice }) },
      workspaceInitializerSaga,
    );
    slice = workspaceInitializerReducer(slice, setWorkspaceInitializerRecentRepos([]));
    channel.put(setWorkspaceInitializerRecentRepos([]));
    slice = workspaceInitializerReducer(
      slice,
      setWorkspaceInitializerLastSelectedRepo({ path: '/boot', type: 'local' }),
    );
    channel.put(setWorkspaceInitializerLastSelectedRepo({ path: '/boot', type: 'local' }));
    await settle();
    expect(mocks.update.mock.calls).toEqual([]);

    resolve({
      value: {
        lastSelectedRepo: { path: '/daemon', type: 'local' },
        recentRepos: [{ path: '/daemon', type: 'local', name: 'daemon' }],
      },
    });
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: null,
              onboardingFormState: null,
              lastSelectedRepo: { path: '/daemon', type: 'local' },
              branchByRepo: {},
              defaultParentPath: '~/Developer',
              recentRepos: [{ path: '/daemon', type: 'local', name: 'daemon' }],
              remoteSetups: [],
              lastSubmittedAgent: null,
            },
          },
        ],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('drops queued writes after a failed hydration', async () => {
    let reject!: (error: Error) => void;
    mocks.get.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)));
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => populatedState() },
      workspaceInitializerSaga,
    );
    channel.put(setCompactWorkspaceInitializerFormState({ repoPath: '/queued' }));
    reject(new Error('offline'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('debounces to the latest draft and cancels explicit cancellation', async () => {
    mocks.get.mockResolvedValue({ value: { lastSelectedRepo: { path: '/repo', type: 'local' } } });
    const channel = stdChannel();
    let slice: WorkspaceInitializerState = initialState;
    const dispatch = vi.fn((action) => {
      slice = workspaceInitializerReducer(slice, action);
      channel.put(action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ workspaceInitializer: slice }) },
      workspaceInitializerSaga,
    );
    await settle();
    mocks.update.mockClear();
    channel.put(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: 'local', repoPath: '/first' },
        step: 'project',
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    channel.put(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: 'local', repoPath: '/latest' },
        step: 'project',
      }),
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: null,
              onboardingFormState: {
                projectSelection: { type: 'local', repoPath: '/latest' },
                step: 'project',
              },
              lastSelectedRepo: { path: '/repo', type: 'local' },
              branchByRepo: {},
              defaultParentPath: '~/Developer',
              recentRepos: [],
              remoteSetups: [],
              lastSubmittedAgent: null,
            },
          },
        ],
      ],
    ]);
    mocks.update.mockClear();
    channel.put(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: 'local', repoPath: '/cancelled' },
        step: 'project',
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    channel.put(cancelWorkspaceInitializerOnboardingFormStateDebounce());
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});

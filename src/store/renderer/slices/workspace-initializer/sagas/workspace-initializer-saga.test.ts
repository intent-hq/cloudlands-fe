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
  draftGet: vi.fn(),
  draftSet: vi.fn(),
  draftClear: vi.fn(),
  generateSetupScript: vi.fn(),
  listSpecialists: vi.fn(),
  listGitHubBranches: vi.fn(),
  listGitHubBranchesCached: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: mocks.get, update: mocks.update },
    drafts: { get: mocks.draftGet, set: mocks.draftSet, clear: mocks.draftClear },
    setupScripts: { generate: mocks.generateSetupScript },
    specialists: { list: mocks.listSpecialists },
    integrations: {
      githubBranches: mocks.listGitHubBranches,
      githubBranchesCached: mocks.listGitHubBranchesCached,
    },
  },
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
vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.invoke }));

import { resetOnboarding } from '$store/renderer/slices/onboarding/onboarding-slice';
import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
  hydrateWorkspaceInitializer,
  initialState,
  generateWorkspaceSetupScriptRequested,
  listGitHubBranchesCachedRequested,
  listGitHubBranchesRequested,
  loadWorkspaceInitializerGitHubBranches,
  searchWorkspaceInitializerGitHubBranches,
  listInitializerSpecialistPreviewsRequested,
  readWorkspaceInitializerPullRequestRequested,
  readWorkspaceInitializerGitRemoteRequested,
  readWorkspaceInitializerGitAvailabilityRequested,
  addWorkspaceInitializerRecentRepositoryRequested,
  openWorkspaceInitializerExternalUrlRequested,
  restoreNewWorkspaceDraftRequested,
  saveNewWorkspaceDraftRequested,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerRecentRepos,
  setGitHubBranchListing,
  setGitHubBranchListingLoading,
  workspaceInitializerReducer,
} from '../workspace-initializer-slice';
import type {
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerState,
} from '../workspace-initializer-types';
import {
  hydrateWorkspaceInitializerWorker,
  generateWorkspaceSetupScriptWorker,
  listInitializerSpecialistPreviewsWorker,
  listGitHubBranchesCachedWorker,
  listGitHubBranchesWorker,
  readWorkspaceInitializerPullRequestWorker,
  readWorkspaceInitializerGitRemoteWorker,
  readWorkspaceInitializerGitAvailabilityWorker,
  addWorkspaceInitializerRecentRepositoryWorker,
  openWorkspaceInitializerExternalUrlWorker,
  clearNewWorkspaceDraftWorker,
  persistNewWorkspaceDraftWorker,
  restoreNewWorkspaceDraftWorker,
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
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftSet.mockResolvedValue({ ok: true, updatedAt: '2026-09-08T00:00:00Z' });
    mocks.draftClear.mockResolvedValue({ ok: true });
    mocks.generateSetupScript.mockResolvedValue(null);
    mocks.listSpecialists.mockResolvedValue([]);
    mocks.listGitHubBranches.mockResolvedValue({ branches: [], defaultBranch: null });
    mocks.listGitHubBranchesCached.mockResolvedValue({
      cached: false,
      branches: [],
      defaultBranch: null,
    });
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

  it('restores the protocol-shaped sentinel draft through the async action', async () => {
    mocks.draftGet.mockResolvedValue({
      text: 'hello',
      attachments: [{ id: 'file-1', type: 'file', label: 'a.ts', sourcePath: '/tmp/a.ts' }],
      updatedAt: '2026-09-08T00:00:00Z',
    });
    sessionStorage.setItem('onboarding-prompt', 'stale');
    const action = restoreNewWorkspaceDraftRequested('onboarding');
    const dispatch = vi.fn();

    await runSaga(
      { dispatch, getState: () => ({}) },
      restoreNewWorkspaceDraftWorker,
      { restoreFailed: true },
      action,
    ).toPromise();

    expect(mocks.draftGet.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(mocks.draftSet.mock.calls).toEqual([]);
    expect(sessionStorage.getItem('onboarding-prompt')).toBe(null);
    expect(dispatch.mock.calls).toEqual([
      [
        action.success({
          status: 'restored',
          text: 'hello',
          contextItems: [{ id: 'file-1', type: 'file', label: 'a.ts', sourcePath: '/tmp/a.ts' }],
        }),
      ],
    ]);
  });

  it('migrates the compact legacy prompt with one exact drafts.set request', async () => {
    sessionStorage.setItem('compact-workspace-initializer-state-prompt', 'legacy');
    const action = restoreNewWorkspaceDraftRequested('compact');
    const dispatch = vi.fn();

    await runSaga(
      { dispatch, getState: () => ({}) },
      restoreNewWorkspaceDraftWorker,
      { restoreFailed: true },
      action,
    ).toPromise();

    expect(mocks.draftGet.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(mocks.draftSet.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'legacy', undefined],
    ]);
    expect(dispatch.mock.calls).toEqual([
      [action.success({ status: 'restored', text: 'legacy', contextItems: [] })],
    ]);
  });

  it('persists and clears sentinel drafts with exact protocol parameters', async () => {
    const save = saveNewWorkspaceDraftRequested('draft', [
      {
        id: 'image-1',
        type: 'file',
        label: 'image.png',
        imageData: 'YWJj',
        imageMimeType: 'image/png',
      },
    ]);
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      persistNewWorkspaceDraftWorker,
      { restoreFailed: false },
      save,
    ).toPromise();
    sessionStorage.setItem('onboarding-prompt', 'legacy');
    sessionStorage.setItem('compact-workspace-initializer-state-prompt', 'legacy');
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      clearNewWorkspaceDraftWorker,
    ).toPromise();

    expect(mocks.draftSet.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'draft', save.payload[1]],
    ]);
    expect(mocks.draftClear.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(sessionStorage.getItem('onboarding-prompt')).toBe(null);
    expect(sessionStorage.getItem('compact-workspace-initializer-state-prompt')).toBe(null);
  });

  it('routes initializer reads through exact daemon methods and parameters', async () => {
    const setup = { script: 'pnpm install', projectType: 'node', updatedAt: 1 };
    const specialists = [{ id: 'builder', name: 'Builder', description: 'Builds' }];
    const cached = { cached: true, branches: ['main'], defaultBranch: 'main' };
    const fresh = { branches: ['main', 'feature'], defaultBranch: 'main' };
    mocks.generateSetupScript.mockResolvedValue(setup);
    mocks.listSpecialists.mockResolvedValue(specialists);
    mocks.listGitHubBranchesCached.mockResolvedValue(cached);
    mocks.listGitHubBranches.mockResolvedValue(fresh);
    const actions = [
      [generateWorkspaceSetupScriptWorker, generateWorkspaceSetupScriptRequested('workspace-1')],
      [
        listInitializerSpecialistPreviewsWorker,
        listInitializerSpecialistPreviewsRequested('claude'),
      ],
      [listGitHubBranchesCachedWorker, listGitHubBranchesCachedRequested('intent-hq', 'intent')],
      [listGitHubBranchesWorker, listGitHubBranchesRequested('intent-hq', 'intent', 'feat')],
    ] as const;
    const dispatch = vi.fn();

    for (const [worker, action] of actions) {
      await runSaga({ dispatch, getState: () => ({}) }, worker, action).toPromise();
    }

    expect(mocks.generateSetupScript.mock.calls).toEqual([['workspace-1']]);
    expect(mocks.listSpecialists.mock.calls).toEqual([['claude']]);
    expect(mocks.listGitHubBranchesCached.mock.calls).toEqual([['intent-hq', 'intent']]);
    expect(mocks.listGitHubBranches.mock.calls).toEqual([['intent-hq', 'intent', 'feat']]);
    expect(dispatch.mock.calls).toEqual([
      [actions[0][1].success(setup)],
      [actions[1][1].success(specialists)],
      [setGitHubBranchListingLoading('intent-hq', 'intent', 'cached')],
      [setGitHubBranchListing('intent-hq', 'intent', 'cached', ['main'], 'main', undefined)],
      [actions[2][1].success(cached)],
      [setGitHubBranchListingLoading('intent-hq', 'intent', 'feat')],
      [setGitHubBranchListing('intent-hq', 'intent', 'feat', ['main', 'feature'], 'main')],
      [actions[3][1].success(fresh)],
    ]);
  });

  it('suppresses a superseded GitHub branch load for the same repository', async () => {
    let resolveStale!: (value: { branches: string[]; defaultBranch: string }) => void;
    const stale = new Promise<{ branches: string[]; defaultBranch: string }>((resolve) => {
      resolveStale = resolve;
    });
    mocks.listGitHubBranches
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce({ branches: ['fresh'], defaultBranch: 'fresh' });
    const channel = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => dispatched.push(action), getState: populatedState },
      workspaceInitializerSaga,
    );

    channel.put(loadWorkspaceInitializerGitHubBranches('race-owner', 'race-repo'));
    await settle();
    await vi.advanceTimersByTimeAsync(149);
    expect(mocks.listGitHubBranches).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.listGitHubBranches).toHaveBeenCalledTimes(1);

    channel.put(loadWorkspaceInitializerGitHubBranches('race-owner', 'race-repo', true));
    await settle();
    await vi.advanceTimersByTimeAsync(150);
    await settle();
    expect(mocks.listGitHubBranches).toHaveBeenCalledTimes(2);
    resolveStale({ branches: ['stale'], defaultBranch: 'stale' });
    await settle();

    expect(dispatched).toContainEqual(
      setGitHubBranchListing('race-owner', 'race-repo', '', ['fresh'], 'fresh'),
    );
    expect(dispatched).not.toContainEqual(
      setGitHubBranchListing('race-owner', 'race-repo', '', ['stale'], 'stale'),
    );
    task.cancel();
    await task.toPromise();
  });

  it('reuses cached GitHub branches until force refresh invalidates them', async () => {
    mocks.listGitHubBranches
      .mockResolvedValueOnce({ branches: ['cached'], defaultBranch: 'cached' })
      .mockResolvedValueOnce({ branches: ['refreshed'], defaultBranch: 'refreshed' });
    const channel = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => dispatched.push(action), getState: populatedState },
      workspaceInitializerSaga,
    );

    channel.put(loadWorkspaceInitializerGitHubBranches('cache-owner', 'cache-repo', false, true));
    await settle();
    await vi.advanceTimersByTimeAsync(150);
    await settle();
    channel.put(loadWorkspaceInitializerGitHubBranches('cache-owner', 'cache-repo', false, true));
    await settle();
    await vi.advanceTimersByTimeAsync(150);
    await settle();
    expect(mocks.listGitHubBranches).toHaveBeenCalledTimes(1);

    channel.put(loadWorkspaceInitializerGitHubBranches('cache-owner', 'cache-repo', true, true));
    await settle();
    await vi.advanceTimersByTimeAsync(150);
    await settle();
    expect(mocks.listGitHubBranches).toHaveBeenCalledTimes(2);
    expect(dispatched).toContainEqual(
      setGitHubBranchListing('cache-owner', 'cache-repo', '', ['refreshed'], 'refreshed'),
    );
    task.cancel();
    await task.toPromise();
  });

  it('debounces GitHub prefix search and publishes only the latest same-repository result', async () => {
    let resolveStale!: (value: { branches: string[]; defaultBranch: string }) => void;
    const stale = new Promise<{ branches: string[]; defaultBranch: string }>((resolve) => {
      resolveStale = resolve;
    });
    mocks.listGitHubBranches
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce({ branches: ['feature/latest'], defaultBranch: 'main' });
    const channel = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => dispatched.push(action), getState: populatedState },
      workspaceInitializerSaga,
    );

    channel.put(searchWorkspaceInitializerGitHubBranches('search-owner', 'search-repo', 'feat'));
    await settle();
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.listGitHubBranches).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.listGitHubBranches).toHaveBeenCalledTimes(1);

    channel.put(searchWorkspaceInitializerGitHubBranches('search-owner', 'search-repo', 'feature'));
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    resolveStale({ branches: ['feature/stale'], defaultBranch: 'main' });
    await settle();

    expect(mocks.listGitHubBranches.mock.calls).toEqual([
      ['search-owner', 'search-repo', 'feat'],
      ['search-owner', 'search-repo', 'feature'],
    ]);
    expect(dispatched).toContainEqual(
      setGitHubBranchListing('search-owner', 'search-repo', 'feature', ['feature/latest'], 'main'),
    );
    expect(dispatched).not.toContainEqual(
      setGitHubBranchListing('search-owner', 'search-repo', 'feat', ['feature/stale'], 'main'),
    );
    task.cancel();
    await task.toPromise();
  });

  it('routes initializer IPC probes and native actions through exact channels', async () => {
    const pullRequest = readWorkspaceInitializerPullRequestRequested('acme', 'app', 42);
    const remote = readWorkspaceInitializerGitRemoteRequested('/repo');
    const availability = readWorkspaceInitializerGitAvailabilityRequested();
    const recent = addWorkspaceInitializerRecentRepositoryRequested({
      repository: 'acme/app',
      name: 'app',
      owner: 'acme',
      githubUrl: 'https://github.com/acme/app',
    });
    const external = openWorkspaceInitializerExternalUrlRequested('https://example.com/docs');
    const dispatch = vi.fn();
    mocks.invoke
      .mockResolvedValueOnce({
        success: true,
        data: { sourceBranch: 'feature', targetBranch: 'main' },
      })
      .mockResolvedValueOnce({ success: true, data: { owner: 'acme', repo: 'app' } })
      .mockResolvedValueOnce({ success: true, data: { available: true, version: '2.0.0' } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    await runSaga(
      { dispatch, getState: () => ({}) },
      readWorkspaceInitializerPullRequestWorker,
      pullRequest,
    ).toPromise();
    await runSaga(
      { dispatch, getState: () => ({}) },
      readWorkspaceInitializerGitRemoteWorker,
      remote,
    ).toPromise();
    await runSaga(
      { dispatch, getState: () => ({}) },
      readWorkspaceInitializerGitAvailabilityWorker,
      availability,
    ).toPromise();
    await runSaga(
      { dispatch, getState: () => ({}) },
      addWorkspaceInitializerRecentRepositoryWorker,
      recent,
    ).toPromise();
    await runSaga(
      { dispatch, getState: () => ({}) },
      openWorkspaceInitializerExternalUrlWorker,
      external,
    ).toPromise();

    expect(mocks.invoke.mock.calls).toEqual([
      ['git-tracking:get-pull-request', { owner: 'acme', repo: 'app', number: 42 }],
      ['git-tracking:get-remote-url', { repoPath: '/repo' }],
      ['system:check-git'],
      ['workspace:add-recent-repository', recent.payload[0]],
      ['shell:openExternal', { url: 'https://example.com/docs' }],
    ]);
    expect(dispatch.mock.calls).toEqual([
      [pullRequest.success({ sourceBranch: 'feature', targetBranch: 'main' })],
      [remote.success({ owner: 'acme', repo: 'app' })],
      [availability.success({ available: true, version: '2.0.0' })],
      [recent.success(undefined)],
      [external.success(undefined)],
    ]);
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

  it('reset cancels drafts, clears the session key, persists null, and root cancellation cleans up', async () => {
    mocks.get.mockResolvedValue({ value: { lastSelectedRepo: { path: '/repo', type: 'local' } } });
    sessionStorage.setItem('onboarding-prompt', 'prompt');
    const channel = stdChannel();
    let slice: WorkspaceInitializerState = {
      ...initialState,
      onboardingFormState: { projectSelection: null, step: 'project' },
    };
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
        projectSelection: { type: 'local', repoPath: '/cancelled' },
        step: 'project',
      }),
    );
    channel.put(resetOnboarding());
    await settle();

    expect(sessionStorage.getItem('onboarding-prompt')).toBe(null);
    expect(slice.onboardingFormState).toBe(null);
    expect(mocks.update.mock.calls).toEqual([
      [
        [
          {
            path: 'workspaceInitializer.state',
            value: {
              compactFormState: null,
              onboardingFormState: null,
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
        projectSelection: { type: 'local', repoPath: '/late' },
        step: 'project',
      }),
    );
    task.cancel();
    await task.toPromise();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.update.mock.calls).toEqual([]);
  });
});

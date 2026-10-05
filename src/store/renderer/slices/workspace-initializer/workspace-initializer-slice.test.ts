import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { describe, expect, it } from 'vitest';
import {
  workspaceInitializerGitCheckRequested,
  workspaceInitializerGitCheckResolved,
  clearWorkspaceInitializerPendingGitHubPrefill,
  DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH,
  hydrateWorkspaceInitializer,
  initialState,
  removeWorkspaceInitializerRemoteSetup,
  dismissWorkspaceInitializerRecentRepo,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerPendingGitHubPrefill,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
  workspaceInitializerReducer,
} from './workspace-initializer-slice';

describe('workspaceInitializerReducer', () => {
  it('returns initial state', () => {
    expect(workspaceInitializerReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('hydrates persisted initializer state', () => {
    const state = workspaceInitializerReducer(
      initialState,
      hydrateWorkspaceInitializer({
        compactFormState: { repoPath: '/repo', selectedModel: 'auggie:default' },
        onboardingFormState: {
          projectSelection: null,
          step: 'project',
          selectedModel: 'pi:claude',
          modelWasOverridden: true,
        },
        lastSelectedRepo: { path: '/repo', type: 'local' },
        branchByRepo: { '/repo': 'dev' },
        defaultParentPath: '~/Code',
        recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
        remoteSetups: [
          {
            id: 'remote-1',
            name: 'Remote',
            host: 'host',
            port: 22,
            username: 'me',
            workspacePath: '/repo',
          },
        ],
        lastSubmittedAgent: { selectedSpecialist: null, selectedModel: 'auggie:default' },
      }),
    );

    expect(state.hydrated).toBe(true);
    expect(state.compactFormState?.repoPath).toBe('/repo');
    expect(state.onboardingFormState?.step).toBe('project');
    expect(state.onboardingFormState?.selectedModel).toBe('pi:claude');
    expect(state.onboardingFormState?.modelWasOverridden).toBe(true);
    expect(state.lastSelectedRepo?.path).toBe('/repo');
    expect(state.branchByRepo['/repo']).toBe('dev');
    expect(state.defaultParentPath).toBe('~/Code');
    expect(state.recentRepos.ids).toEqual(['/repo']);
    expect(state.remoteSetups.ids).toEqual(['remote-1']);
    expect(state.lastSubmittedAgent?.selectedModel).toBe('auggie:default');
  });

  it('hydrates last selected repo after mount without overwriting in-progress compact state', () => {
    const preHydrationState = workspaceInitializerReducer(
      initialState,
      setCompactWorkspaceInitializerFormState({ repoPath: '/typed-before-hydration' }),
    );

    const hydratedState = workspaceInitializerReducer(
      preHydrationState,
      hydrateWorkspaceInitializer({
        compactFormState: null,
        lastSelectedRepo: { path: '/persisted', type: 'local', isValidPath: true },
      }),
    );

    expect(hydratedState.hydrated).toBe(true);
    expect(hydratedState.compactFormState?.repoPath).toBe('/typed-before-hydration');
    expect(hydratedState.lastSelectedRepo?.path).toBe('/persisted');
  });

  it.each(['high', ''])(
    'keeps a pending effort edit %j with its model/provider through hydration',
    (effort) => {
      const current = {
        selectedModel: 'gpt-fixture',
        selectedProvider: 'codex',
        selectedReasoningEffort: effort,
      };
      const pending = workspaceInitializerReducer(
        initialState,
        setCompactWorkspaceInitializerFormState(current),
      );
      const hydrated = workspaceInitializerReducer(
        pending,
        hydrateWorkspaceInitializer({
          compactFormState: {
            selectedModel: 'old-model',
            selectedProvider: 'auggie',
            selectedReasoningEffort: 'low',
          },
        }),
      );
      expect(hydrated.compactFormState).toEqual(current);
    },
  );

  it('sets form state, repo selection, branch, default parent, and agent settings', () => {
    let state = workspaceInitializerReducer(
      initialState,
      setCompactWorkspaceInitializerFormState({ repoPath: '/repo' }),
    );
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerOnboardingFormState({ projectSelection: null, skipIsolation: true }),
    );
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerLastSelectedRepo({ path: '/repo', type: 'local', isValidPath: true }),
    );
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerBranchForRepo('/repo', 'feature'),
    );
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerDefaultParentPath('~/Projects'),
    );
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerLastSubmittedAgent({
        selectedSpecialist: 'builder',
        isTeamMode: false,
      }),
    );

    expect(state.compactFormState?.repoPath).toBe('/repo');
    expect(state.onboardingFormState?.skipIsolation).toBe(true);
    expect(state.lastSelectedRepo?.isValidPath).toBe(true);
    expect(state.branchByRepo['/repo']).toBe('feature');
    expect(state.defaultParentPath).toBe('~/Projects');
    expect(state.lastSubmittedAgent?.isTeamMode).toBe(false);
  });

  it('normalizes recent repos and remote setups', () => {
    const recentRepos = Array.from({ length: 12 }, (_, index) => ({
      path: index === 10 ? '' : `/repo-${index}`,
      type: 'local' as const,
      name: `repo-${index}`,
    }));
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerRecentRepos(recentRepos),
    );
    expect(state.recentRepos.ids).toHaveLength(9);
    expect(state.recentRepos.ids).not.toContain('');

    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerRemoteSetups([
        { id: 'one', name: 'One', host: 'h', port: 22, username: 'u', workspacePath: '/one' },
      ]),
    );
    state = workspaceInitializerReducer(
      state,
      upsertWorkspaceInitializerRemoteSetup({
        id: 'two',
        name: 'Two',
        host: 'h',
        port: 22,
        username: 'u',
        workspacePath: '/two',
      }),
    );
    expect(state.remoteSetups.ids).toEqual(['one', 'two']);

    state = workspaceInitializerReducer(state, removeWorkspaceInitializerRemoteSetup('one'));
    expect(state.remoteSetups.ids).toEqual(['two']);
  });

  it('dismisses only the matching recent entry and ignores stale source refreshes', () => {
    const repos = [
      { path: '/app', type: 'local' as const, name: 'app' },
      { path: '/other/app', type: 'local' as const, name: 'app' },
      { path: 'Owner/App', type: 'github' as const, name: 'App' },
    ];
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerRecentRepos(repos),
    );
    state = workspaceInitializerReducer(state, dismissWorkspaceInitializerRecentRepo(repos[0]));
    state = workspaceInitializerReducer(state, dismissWorkspaceInitializerRecentRepo(repos[2]));
    expect(state.recentRepos.ids).toEqual(['/other/app']);
    expect(state.lastSelectedRepo).toBeNull();
    expect(state.dismissedRecentRepoKeys).toEqual({ 'local:/app': true, 'github:owner/app': true });
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerRecentRepos([
        ...repos,
        { path: 'owner/app', type: 'github', name: 'app' },
      ]),
    );
    expect(state.recentRepos.ids).toEqual(['/other/app']);
  });

  it('filters hydrated recents and keeps dismissals made while hydration was pending', () => {
    const repo = { path: '/app', type: 'local' as const, name: 'app' };
    const pending = workspaceInitializerReducer(
      initialState,
      dismissWorkspaceInitializerRecentRepo(repo),
    );
    const state = workspaceInitializerReducer(
      pending,
      hydrateWorkspaceInitializer({
        recentRepos: [repo, { path: 'Owner/App', type: 'github', name: 'App' }],
        dismissedRecentRepoKeys: { 'github:owner/app': true },
      }),
    );
    expect(state.recentRepos.ids).toEqual([]);
    expect(state.dismissedRecentRepoKeys).toEqual({ 'local:/app': true, 'github:owner/app': true });
    expect(
      workspaceInitializerReducer(
        initialState,
        hydrateWorkspaceInitializer({ recentRepos: [repo] }),
      ).recentRepos.ids,
    ).toEqual(['/app']);
  });

  it('applies dismissals before the recent repository limit', () => {
    const repos = Array.from({ length: 12 }, (_, i) => ({
      path: `/repo-${i}`,
      type: 'local' as const,
      name: `repo-${i}`,
    }));
    const state = workspaceInitializerReducer(
      workspaceInitializerReducer(initialState, dismissWorkspaceInitializerRecentRepo(repos[0])),
      setWorkspaceInitializerRecentRepos(repos),
    );
    expect(state.recentRepos.ids).toHaveLength(9);
    expect(state.recentRepos.ids).toContain('/repo-9');
    expect(state.recentRepos.ids).not.toContain('/repo-0');
  });

  it('keeps dismissals during partial hydration and ignores an empty dismissal', () => {
    let state = workspaceInitializerReducer(initialState, hydrateWorkspaceInitializer({}));
    state = workspaceInitializerReducer(
      state,
      dismissWorkspaceInitializerRecentRepo({ path: '/app', type: 'local' }),
    );
    state = workspaceInitializerReducer(state, hydrateWorkspaceInitializer({ branchByRepo: {} }));
    expect(state.dismissedRecentRepoKeys).toEqual({ 'local:/app': true });
    expect(
      workspaceInitializerReducer(
        state,
        dismissWorkspaceInitializerRecentRepo({ path: '', type: 'local' }),
      ),
    ).toBe(state);
  });

  it('keeps newer source refresh rows when older settings hydrate after a dismissal', () => {
    const app = { path: '/app', type: 'local' as const, name: 'app' };
    const newlyFound = { path: '/newly-found', type: 'local' as const, name: 'newly-found' };
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerRecentRepos([app, newlyFound]),
    );
    state = workspaceInitializerReducer(state, dismissWorkspaceInitializerRecentRepo(app));
    state = workspaceInitializerReducer(state, hydrateWorkspaceInitializer({ recentRepos: [app] }));
    expect(state.recentRepos.ids).toEqual(['/newly-found']);
  });

  it('filters the full source refresh before limiting rows when dismissal settings arrive late', () => {
    const repos = Array.from({ length: 12 }, (_, i) => ({
      path: `/repo-${i}`,
      type: 'local' as const,
      name: `repo-${i}`,
    }));
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerRecentRepos(repos),
    );
    state = workspaceInitializerReducer(state, dismissWorkspaceInitializerRecentRepo(repos[1]));
    state = workspaceInitializerReducer(
      state,
      hydrateWorkspaceInitializer({
        recentRepos: [repos[0]],
        dismissedRecentRepoKeys: { 'local:/repo-0': true },
      }),
    );
    expect(state.recentRepos.ids).toEqual(repos.slice(2, 11).map((repo) => repo.path));
  });

  it('keeps an empty source refresh authoritative over older persisted suggestions', () => {
    const state = workspaceInitializerReducer(
      workspaceInitializerReducer(initialState, setWorkspaceInitializerRecentRepos([])),
      hydrateWorkspaceInitializer({ recentRepos: [{ path: '/old', type: 'local', name: 'old' }] }),
    );
    expect(state.recentRepos.ids).toEqual([]);
  });

  it('falls back to the default parent for blank values and ignores empty branch repo keys', () => {
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerDefaultParentPath(''),
    );
    expect(state.defaultParentPath).toBe(DEFAULT_WORKSPACE_INITIALIZER_PARENT_PATH);

    state = workspaceInitializerReducer(state, setWorkspaceInitializerBranchForRepo('', 'main'));
    expect(state.branchByRepo).toEqual({});
  });

  it('sets and clears the pending GitHub prefill', () => {
    expect(initialState.pendingGitHubPrefill).toBeNull();

    const prefill = {
      owner: 'intent-hq',
      repo: 'monorepo',
      number: 123,
      kind: 'pr' as const,
      url: 'https://github.com/intent-hq/monorepo/pull/123',
    };
    let state = workspaceInitializerReducer(
      initialState,
      setWorkspaceInitializerPendingGitHubPrefill(prefill),
    );
    expect(state.pendingGitHubPrefill).toEqual(prefill);

    const issuePrefill = {
      owner: 'intent-hq',
      repo: 'intentd',
      number: 7,
      kind: 'issue' as const,
      url: 'https://github.com/intent-hq/intentd/issues/7',
    };
    state = workspaceInitializerReducer(
      state,
      setWorkspaceInitializerPendingGitHubPrefill(issuePrefill),
    );
    expect(state.pendingGitHubPrefill).toEqual(issuePrefill);

    state = workspaceInitializerReducer(state, clearWorkspaceInitializerPendingGitHubPrefill());
    expect(state.pendingGitHubPrefill).toBeNull();
  });

  it('does not persist a pending GitHub prefill across hydration', () => {
    const prefill = {
      owner: 'o',
      repo: 'r',
      number: 1,
      kind: 'issue' as const,
      url: 'https://github.com/o/r/issues/1',
    };
    const state = workspaceInitializerReducer(
      workspaceInitializerReducer(
        initialState,
        setWorkspaceInitializerPendingGitHubPrefill(prefill),
      ),
      hydrateWorkspaceInitializer({ compactFormState: null }),
    );
    // Hydration leaves the transient prefill untouched (it is never part of the persisted bag)
    expect(state.pendingGitHubPrefill).toEqual(prefill);
  });
});

it('keeps Git probe results transient and clears them for a fresh request', () => {
  const requested = workspaceInitializerReducer(
    initialState,
    workspaceInitializerGitCheckRequested(),
  );
  expect(requested.gitCheckRequest).toBe(1);
  expect(requested.gitCheck).toBeNull();
  const resolved = workspaceInitializerReducer(
    requested,
    workspaceInitializerGitCheckResolved('host-A/member', false),
  );
  expect(resolved.gitCheck).toEqual({ context: 'host-A/member', available: false });
  const next = workspaceInitializerReducer(resolved, workspaceInitializerGitCheckRequested());
  expect(next.gitCheckRequest).toBe(2);
  expect(next.gitCheck).toBeNull();
});

it('renews an already mounted Git check when host execution resets initializer state', () => {
  const requested = workspaceInitializerReducer(
    initialState,
    workspaceInitializerGitCheckRequested(),
  );
  const changed = workspaceInitializerReducer(requested, hostExecutionConnectionChanged('host-B'));
  expect(changed.gitCheckRequest).toBe(2);
  expect(changed.gitCheck).toBeNull();
  expect(
    workspaceInitializerReducer(initialState, hostExecutionConnectionChanged('host-B'))
      .gitCheckRequest,
  ).toBe(0);
});

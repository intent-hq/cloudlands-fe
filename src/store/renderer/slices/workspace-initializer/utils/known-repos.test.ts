import { describe, expect, it } from 'vitest';
import {
  createCollection,
  getItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { initialState as gitlabAuthInitialState } from '../../gitlab-auth/gitlab-auth-slice';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectKnownRepos, selectPaletteKnownRepos } from '../workspace-initializer-selectors';
import { initialState } from '../workspace-initializer-slice';
import type { WorkspaceInitializerRecentRepo } from '../workspace-initializer-types';
import { getRecentRepoSource } from '$lib/components/workspace/initializer/recent-repo-display';
import {
  decideKnownReposLoad,
  KNOWN_REPOS_REFRESH_ID,
  KNOWN_REPOS_RELOAD_AFTER_MS,
  knownRepoLastUsedMs,
  mergeKnownRepos,
  prefillForRepo,
} from './known-repos';

const local = (path: string, lastUsedAt?: string): WorkspaceInitializerRecentRepo => ({
  path,
  type: 'local',
  name: path.split('/').at(-1)!,
  ...(lastUsedAt ? { lastUsedAt } : {}),
});
const github = (shorthand: string): WorkspaceInitializerRecentRepo => ({
  path: shorthand,
  type: 'github',
  githubUrl: `https://github.com/${shorthand}`,
  name: shorthand.split('/')[1],
  owner: shorthand.split('/')[0],
});
const gitlab: WorkspaceInitializerRecentRepo = {
  path: 'https://gitlab.example.test/team/sub/app',
  type: 'github',
  githubUrl: 'https://gitlab.example.test/team/sub/app',
  name: 'app',
  owner: 'team/sub',
  repositoryIdentity: {
    provider: 'gitlab',
    instanceBaseUrl: 'https://gitlab.example.test',
    projectPath: 'team/sub/app',
  },
};

function paletteState(
  saved: WorkspaceInitializerRecentRepo[],
  loaded: WorkspaceInitializerRecentRepo[] | null,
  dismissed: Record<string, true> = {},
  role: 'owner' | 'guest' = 'owner',
) {
  const state = withLegacyPrincipal(
    {
      gitlabAuth: gitlabAuthInitialState,
      workspaceInitializer: {
        ...initialState,
        recentRepos: createCollection<WorkspaceInitializerRecentRepo, 'path'>('path', saved),
        dismissedRecentRepoKeys: dismissed,
      },
    },
    role,
  );
  if (loaded) {
    state.workspaceInitializer.recentRepoRefreshes = upsertItem(
      state.workspaceInitializer.recentRepoRefreshes,
      {
        id: KNOWN_REPOS_REFRESH_ID,
        requestId: 'r1',
        admission: selectPrincipalActionContext.select(state)!,
        status: 'ready',
        repos: loaded,
        workspaces: [],
        registryRepos: [],
      },
    );
  }
  return state;
}

describe('shared known-repo list', () => {
  // Twelve loaded repos: more than the 9 the saved list keeps.
  const loaded = [
    local('/code/app', '2026-03-01T00:00:00.000Z'),
    github('octo/app'),
    gitlab,
    ...Array.from({ length: 9 }, (_, i) => local(`/code/extra-${i}`)),
  ];
  const saved = [local('/code/saved-only'), github('octo/app')];

  it('gives the picker and the palette the same list for the same input', () => {
    const dismissed = { 'local:/code/extra-3': true as const };
    const picker = mergeKnownRepos({
      saved,
      source: { repos: loaded },
      dismissed,
      mode: 'all',
    });
    const palette = selectKnownRepos.select(paletteState(saved, loaded, dismissed));
    expect(palette).toEqual(picker);
    expect(palette.map((repo) => repo.path)).toEqual([
      '/code/app',
      'octo/app',
      gitlab.path,
      ...[0, 1, 2, 4, 5, 6, 7, 8].map((i) => `/code/extra-${i}`),
      '/code/saved-only',
    ]);
  });

  it('shows the saved list before the full load lands', () => {
    expect(selectKnownRepos.select(paletteState(saved, null))).toEqual(saved);
  });

  it('ignores a load made for another admission', () => {
    const state = paletteState(saved, loaded);
    const entry = state.workspaceInitializer.recentRepoRefreshes;
    state.workspaceInitializer.recentRepoRefreshes = upsertItem(entry, {
      ...getItem(entry, KNOWN_REPOS_REFRESH_ID)!,
      admission: 'someone-else',
    });
    expect(selectKnownRepos.select(state)).toEqual(saved);
  });

  it('never returns dismissed repos, even when only the load still has them', () => {
    const repos = selectKnownRepos.select(
      paletteState(saved, loaded, { 'github:octo/app': true, 'local:/code/app': true }),
    );
    expect(repos.map((repo) => repo.path)).not.toContain('octo/app');
    expect(repos.map((repo) => repo.path)).not.toContain('/code/app');
  });

  it('keeps a local clone and the GitHub entry of one repo as two sources', () => {
    const repos = selectKnownRepos.select(paletteState([], loaded));
    expect(repos.slice(0, 3).map((repo) => getRecentRepoSource(repo))).toEqual([
      'local',
      'github',
      'gitlab',
    ]);
    expect(getRecentRepoSource({ ...local('/notes'), plainFolder: true })).toBe('folder');
  });

  it('keeps lastUsedAt for recency', () => {
    const [first] = selectKnownRepos.select(paletteState([], loaded));
    expect(knownRepoLastUsedMs(first)).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(knownRepoLastUsedMs(github('octo/app'))).toBe(0);
  });

  it('hides palette repos when workspace creation is hidden', () => {
    expect(selectPaletteKnownRepos.select(paletteState(saved, loaded))).toHaveLength(13);
    expect(selectPaletteKnownRepos.select(paletteState(saved, loaded, {}, 'guest'))).toEqual([]);
  });

  it('keeps the legacy tabbed picker on the first 9 saved-first entries', () => {
    const recent = mergeKnownRepos({
      saved,
      source: { repos: loaded },
      dismissed: {},
      mode: 'recent',
    });
    expect(recent).toHaveLength(9);
    expect(recent[0].path).toBe('/code/saved-only');
  });
});

describe('full repo load decision', () => {
  const entry = { requestId: 'r1', admission: 'a', status: 'ready' as const };
  const base = { visible: true, admission: 'a', entry, readyAt: { requestId: 'r1', at: 1_000 } };

  it('loads when nothing is loaded for this admission', () => {
    expect(decideKnownReposLoad({ ...base, entry: undefined, readyAt: null, now: 1 })).toBe('load');
    expect(decideKnownReposLoad({ ...base, entry: { ...entry, admission: 'b' }, now: 1_001 })).toBe(
      'load',
    );
  });

  it('reuses a running load', () => {
    expect(decideKnownReposLoad({ ...base, entry: { ...entry, status: 'pending' }, now: 1 })).toBe(
      'reuse',
    );
  });

  it('skips a fresh load and reloads after the throttle window', () => {
    expect(decideKnownReposLoad({ ...base, now: 1_000 + KNOWN_REPOS_RELOAD_AFTER_MS - 1 })).toBe(
      'skip',
    );
    expect(decideKnownReposLoad({ ...base, now: 1_000 + KNOWN_REPOS_RELOAD_AFTER_MS })).toBe(
      'load',
    );
  });

  it('retries after a failed load', () => {
    expect(
      decideKnownReposLoad({ ...base, entry: { ...entry, status: 'failed' }, now: 1_001 }),
    ).toBe('load');
  });

  it('never loads while workspace creation is hidden or unadmitted', () => {
    expect(decideKnownReposLoad({ ...base, visible: false, entry: undefined, now: 1 })).toBe(
      'skip',
    );
    expect(decideKnownReposLoad({ ...base, admission: null, entry: undefined, now: 1 })).toBe(
      'skip',
    );
  });
});

describe('prefillForRepo', () => {
  it('selects a local clone or plain folder by path', () => {
    expect(prefillForRepo(local('/code/app'))).toEqual({ repoPath: '/code/app' });
    expect(prefillForRepo({ ...local('/notes'), plainFolder: true })).toEqual({
      repoPath: '/notes',
      plainFolder: true,
    });
  });

  it('selects the GitHub repo itself, never a local clone of it', () => {
    expect(prefillForRepo(github('Octo/App'))).toEqual({
      githubUrl: 'https://github.com/Octo/App',
      exactRemote: true,
    });
    expect(
      prefillForRepo({ path: 'octo/app', type: 'github', name: 'app', owner: 'octo' }),
    ).toEqual({ githubUrl: 'https://github.com/octo/app', exactRemote: true });
  });

  it('selects a GitLab project through a checkout draft', () => {
    expect(prefillForRepo(gitlab)).toEqual({
      repositoryCheckoutDraft: {
        instanceBaseUrl: 'https://gitlab.example.test',
        projectPath: 'team/sub/app',
      },
    });
  });
});

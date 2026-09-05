import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_CREATION_PARENT_PATH,
  hydrateWorkspaceCreationSettings,
  initialState,
  removeWorkspaceCreationRemoteSetup,
  setWorkspaceCreationBranchForRepo,
  setWorkspaceCreationDefaultParentPath,
  setWorkspaceCreationLastSelectedRepo,
  setWorkspaceCreationRecentRepos,
  setWorkspaceCreationRemoteSetups,
  upsertWorkspaceCreationRemoteSetup,
  workspaceCreationSettingsReducer,
} from './workspace-creation-settings-slice';

describe('workspaceCreationSettingsReducer', () => {
  it('returns neutral initial settings', () => {
    expect(workspaceCreationSettingsReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('hydrates shared creation settings without retired form state', () => {
    const state = workspaceCreationSettingsReducer(
      initialState,
      hydrateWorkspaceCreationSettings({
        lastSelectedRepo: { path: '/repo', type: 'local' },
        branchByRepo: { '/repo': 'dev' },
        defaultParentPath: '~/Code',
        recentRepos: [{ path: '/repo', type: 'local', name: 'repo' }],
        remoteSetups: [
          {
            id: 'remote',
            name: 'Remote',
            host: 'host',
            port: 22,
            username: 'me',
            workspacePath: '/repo',
          },
        ],
      }),
    );
    expect(state.hydrated).toBe(true);
    expect(state.lastSelectedRepo?.path).toBe('/repo');
    expect(state.branchByRepo).toEqual({ '/repo': 'dev' });
    expect(state.defaultParentPath).toBe('~/Code');
    expect(state.recentRepos.ids).toEqual(['/repo']);
    expect(state.remoteSetups.ids).toEqual(['remote']);
  });

  it('updates repo, branch, parent, recent repos, and remote setups', () => {
    let state = workspaceCreationSettingsReducer(
      initialState,
      setWorkspaceCreationLastSelectedRepo({ path: '/repo', type: 'local' }),
    );
    state = workspaceCreationSettingsReducer(
      state,
      setWorkspaceCreationBranchForRepo('/repo', 'main'),
    );
    state = workspaceCreationSettingsReducer(
      state,
      setWorkspaceCreationDefaultParentPath('~/Projects'),
    );
    state = workspaceCreationSettingsReducer(
      state,
      setWorkspaceCreationRecentRepos(
        Array.from({ length: 12 }, (_, index) => ({
          path: `/repo-${index}`,
          type: 'local' as const,
          name: `repo-${index}`,
        })),
      ),
    );
    state = workspaceCreationSettingsReducer(
      state,
      setWorkspaceCreationRemoteSetups([
        { id: 'one', name: 'One', host: 'h', port: 22, username: 'u', workspacePath: '/one' },
      ]),
    );
    state = workspaceCreationSettingsReducer(
      state,
      upsertWorkspaceCreationRemoteSetup({
        id: 'two',
        name: 'Two',
        host: 'h',
        port: 22,
        username: 'u',
        workspacePath: '/two',
      }),
    );
    state = workspaceCreationSettingsReducer(state, removeWorkspaceCreationRemoteSetup('one'));

    expect(state.lastSelectedRepo?.path).toBe('/repo');
    expect(state.branchByRepo).toEqual({ '/repo': 'main' });
    expect(state.defaultParentPath).toBe('~/Projects');
    expect(state.recentRepos.ids).toHaveLength(9);
    expect(state.remoteSetups.ids).toEqual(['two']);
  });

  it('ignores blank branch keys and restores the default parent', () => {
    let state = workspaceCreationSettingsReducer(
      initialState,
      setWorkspaceCreationBranchForRepo('', 'main'),
    );
    state = workspaceCreationSettingsReducer(state, setWorkspaceCreationDefaultParentPath(''));
    expect(state.branchByRepo).toEqual({});
    expect(state.defaultParentPath).toBe(DEFAULT_WORKSPACE_CREATION_PARENT_PATH);
  });
});

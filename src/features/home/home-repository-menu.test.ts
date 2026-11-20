import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import type { RepositoryGroup } from '$lib/components/workspace/utils/workspace-grouping';
import type {
  SidebarMenuEntry,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar-context-menu/types';
import type { Workspace } from '$shared/types';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import { createHomeRepositoryMenu } from './home-repository-menu';

const local: RepositoryGroup = {
  key: '/repos/tools',
  label: 'tools',
  isGithub: false,
  repoPath: '/repos/tools',
  workspaces: [],
};
const github: RepositoryGroup = {
  key: 'acme/app',
  label: 'acme/app',
  isGithub: true,
  owner: 'acme',
  repoPath: '/repos/app',
  workspaces: [],
};
const ids = (entries: SidebarMenuEntry[]) =>
  entries.flatMap((entry) => ('id' in entry ? [entry.id] : []));
const item = (entries: SidebarMenuEntry[], id: string) =>
  entries.find((entry) => 'id' in entry && entry.id === id) as SidebarMenuItem;

function menu(repo: RepositoryGroup, canCreate = true) {
  const onLeave = vi.fn();
  const entries = createHomeRepositoryMenu({
    repo,
    canCreate,
    hidden: false,
    loaded: true,
    onNewWorkspace: vi.fn(),
    onClose: vi.fn(),
    onLeave,
  });
  return { entries, onLeave };
}
function dispatched(action: () => void) {
  const dispatch = vi.spyOn(store, 'dispatch').mockImplementation((value) => value);
  action();
  return dispatch.mock.calls.map(([value]) => value as { type: string; payload?: unknown });
}

beforeEach(() => store.init());
afterEach(() => vi.restoreAllMocks());

describe('createHomeRepositoryMenu', () => {
  it('deletes an owner local folder from the recent list and leaves it', () => {
    const { entries, onLeave } = menu(local);
    expect(ids(entries)).not.toContain('hide');
    const actions = dispatched(() => item(entries, 'delete').onClick?.());
    expect(onLeave).toHaveBeenCalledOnce();
    expect(actions).toEqual([
      { type: 'knownRepos/removeRecentRepository', payload: ['/repos/tools'] },
    ]);
  });

  it('removes a deleted local folder that still has workspaces, not just hides it', () => {
    const workspace = { createdAt: '2026-09-01T00:00:00Z' } as Workspace;
    const { entries } = menu({ ...local, workspaces: [workspace] });
    const actions = dispatched(() => item(entries, 'delete').onClick?.());
    expect(actions.map((action) => action.type)).toEqual([
      'homeWorkspaces/repositoryRemoved',
      'knownRepos/removeRecentRepository',
    ]);
    expect(actions[1]!.payload).toEqual(['/repos/tools', '/repos/tools']);
  });

  // A window with a stale folder list must not read the old entry as a re-add.
  it('records the removal no earlier than when the folder was added', () => {
    store.dispatch(
      setRepos([
        {
          path: '/repos/tools',
          name: 'tools',
          addedAt: '2026-10-01T00:00:00Z',
          lastUsedAt: '2026-10-01T00:00:00Z',
        },
      ]),
    );
    const workspace = { createdAt: '2026-09-01T00:00:00Z' } as Workspace;
    const { entries } = menu({ ...local, workspaces: [workspace] });
    const actions = dispatched(() => item(entries, 'delete').onClick?.());
    expect(actions[0]!.payload).toEqual({
      key: '/repos/tools',
      newest: Date.parse('2026-10-01T00:00:00Z'),
    });
  });

  it('hides GitHub repositories', () => {
    expect(ids(menu(github).entries)).toEqual(['new-workspace', 'hide']);
  });

  it('only hides local folders for collaborators, leaving the host list alone', () => {
    const { entries } = menu(local, false);
    expect(ids(entries)).toEqual(['hide']);
    const actions = dispatched(() => item(entries, 'hide').onClick?.());
    expect(actions.map((action) => action.type)).toEqual(['homeWorkspaces/repositoryHidden']);
  });
});

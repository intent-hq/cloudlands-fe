/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import {
  principalReceived,
  hostMembershipChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  selectWorkspaceById,
  selectWorkspaceActionContext,
} from '$store/renderer/slices/workspace/workspace-selectors';
import type { Workspace } from '$shared/types';
import BranchDisplay from '../BranchDisplay.svelte';
import CommitsTimeline from '../CommitsTimeline.svelte';
const mocks = vi.hoisted(() => {
  const selector = (value: unknown) =>
    Object.assign(
      () => ({
        subscribe(run: (v: unknown) => void) {
          run(value);
          return () => {};
        },
      }),
      { select: () => value },
    );
  return { update: vi.fn(), selector };
});
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: { update: mocks.update },
    git: { commitDetails: vi.fn(async () => null) },
  },
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingCommits: mocks.selector([
    {
      hash: 'abc',
      message: 'A commit',
      author: 'Test',
      timestamp: 0,
      stage: 'local',
      isPushed: false,
    },
  ]),
  selectFileTrackingBoundarySha: mocks.selector(null),
  selectFileTrackingOlderCommits: mocks.selector([]),
  selectFileTrackingLoadingOlderCommits: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectPostMergeState: mocks.selector({ hasRemote: true }),
  selectGitOperationFlags: mocks.selector({ isPushing: false }),
  selectGitCommitDetailsFiles: mocks.selector({}),
}));
vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => ({
  default: (await import('./mocks/MockBranchSelector.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async (original) => ({
  ...(await original<typeof import('$lib/components/ui/tooltip')>()),
  Tooltip: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte', async () => ({
  default: (await import('./mocks/MockSidebarContextMenu.svelte')).default,
}));
vi.mock('$lib/components/file-tracking/accept-changes/FileRow.svelte', async () => ({
  default: (await import('./mocks/MockFileRow.svelte')).default,
}));
vi.mock('$lib/components/ui/Header.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/shared/LineChangesBadge.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), custom: vi.fn() },
}));
const row = {
  id: 'ws-1',
  title: 'Scoped',
  status: 'active',
  branch: 'feature/branch',
  baseRef: 'main',
  baseCommitSha: '',
  repositoryPath: '/repo',
  worktreePath: '/repo',
  myRole: 'owner',
  canManage: true,
} as Workspace;
let dispose: () => void;
function admit(role: 'owner' | 'member' | 'guest', revision = 1) {
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      {
        context: p.context!,
        invalidation: p.invalidation,
        presentationVersion: p.presentationVersion,
      },
      {
        principal: {
          id: 'principal',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: role === 'owner',
          hostRole: role,
          hostMembershipRevision: revision,
        },
        capabilities: {
          hostMembership: true,
          personalPairing: false,
          authenticatedDevices: false,
          collaborationIdentity: false,
        },
      },
    ),
  );
}
function loaded() {
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit('guest');
  store.dispatch(setWorkspaceEntity(row));
  loaded();
  mocks.update.mockImplementation(async (request) => ({
    success: true,
    workspace: { ...row, ...request },
  }));
});
afterEach(() => {
  cleanup();
  dispose();
});
async function persist(kind: 'branch' | 'base commit') {
  if (kind === 'branch') {
    const view = render(BranchDisplay, {
      props: {
        workspaceId: row.id,
        trunkBranch: 'main',
        repoPath: '/repo',
        repoType: 'local',
        canChangeTrunk: true,
        isOwner: true,
      },
    });
    await fireEvent.click(view.container.querySelector('[data-testid="branch-selector-change"]')!);
  } else {
    const view = render(CommitsTimeline, {
      props: {
        workspaceId: row.id,
        activeFilePath: null,
        activeFileStaged: null,
        pullRequestCount: 0,
        isOwner: selectWorkspaceActionContext.select(store.state, row.id) !== null,
        canUpdateBaseCommit: true,
      },
    });
    await fireEvent.contextMenu(view.container.querySelector('div.group')!, {
      clientX: 10,
      clientY: 20,
    });
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid="menu-item"]')).toBeTruthy(),
    );
    const button = Array.from(view.container.querySelectorAll('[data-testid="menu-item"]')).find(
      (x) => x.textContent?.trim() === 'Set as base commit',
    );
    expect(button).toBeDefined();
    await fireEvent.click(button!);
  }
}
describe('actual protected-field consumers with real store and client', () => {
  it.each(['owner', 'member', 'guest'] as const)(
    '%s scoped manager persists branch and base commit',
    async (role) => {
      admit(role);
      if (role === 'owner') store.dispatch(setLabsMultiplayerEnabled(false));
      loaded();
      await persist('branch');
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ id: row.id, baseRef: 'develop' }),
      );
      expect(selectWorkspaceById.select(store.state, row.id)?.baseRef).toBe('develop');
      cleanup();
      mocks.update.mockClear();
      await persist('base commit');
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ id: row.id, baseCommitSha: 'abc' }),
      );
      expect(selectWorkspaceById.select(store.state, row.id)?.baseCommitSha).toBe('abc');
    },
  );
  it.each(['ordinary guest', 'false', 'missing', 'stale'] as const)(
    'rejects protected fields under %s proof',
    async (kind) => {
      if (kind === 'stale')
        store.dispatch(
          hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }),
        );
      else
        store.dispatch(
          setWorkspaceEntity({
            ...row,
            myRole: kind === 'ordinary guest' ? 'collaborator' : 'owner',
            canManage: kind === 'missing' ? undefined : false,
          }),
        );
      await persist('branch');
      cleanup();
      await persist('base commit');
      expect(mocks.update).not.toHaveBeenCalled();
      expect(selectWorkspaceById.select(store.state, row.id)?.baseRef).toBe('main');
      expect(selectWorkspaceById.select(store.state, row.id)?.baseCommitSha).toBe('');
    },
  );
});

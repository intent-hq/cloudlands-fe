import { describe, expect, it } from 'vitest';

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import {
  closeShareDialog,
  initialState,
  openShareDialog,
  shareActionSettled,
  shareDataFailed,
  shareDataLoaded,
  shareDataRequested,
  shareInviteCreated,
  shareInviteCreateFailed,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
  workspaceShareReducer,
  type WorkspaceShareState,
} from './workspace-share-slice';

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};

const invite: WorkspaceInvite = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  createdByPrincipalId: 'p-alice',
  pinLogin: 'carol',
  pinGithubUserId: 3,
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

function opened(): WorkspaceShareState {
  return workspaceShareReducer(
    initialState,
    openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }),
  );
}

function reduce(
  state: WorkspaceShareState,
  ...actions: Parameters<typeof workspaceShareReducer>[1][]
) {
  return actions.reduce(workspaceShareReducer, state);
}

describe('workspaceShareReducer', () => {
  it('starts closed with no target and no rows', () => {
    expect(initialState).toMatchObject({
      open: false,
      workspaceId: null,
      loadStatus: 'idle',
      creating: false,
      createdLink: null,
    });
    expect(getItems(initialState.members)).toEqual([]);
    expect(getItems(initialState.invites)).toEqual([]);
  });

  it('openShareDialog records the target workspace', () => {
    expect(opened()).toEqual({
      ...initialState,
      open: true,
      workspaceId: 'ws-1',
      workspaceTitle: 'My Space',
    });
  });

  it('openShareDialog retargets an already-open dialog and drops the previous rows', () => {
    const loaded = reduce(
      opened(),
      shareDataLoaded({ workspaceId: 'ws-1', members: [owner], invites: [invite] }),
      shareInviteCreated({ url: 'intent://invite?t=1' }),
    );
    const retargeted = workspaceShareReducer(
      loaded,
      openShareDialog({ workspaceId: 'ws-2', workspaceTitle: 'B' }),
    );
    expect(retargeted).toEqual({
      ...initialState,
      open: true,
      workspaceId: 'ws-2',
      workspaceTitle: 'B',
    });
  });

  it('closeShareDialog resets to the initial state', () => {
    const loaded = reduce(
      opened(),
      shareDataLoaded({ workspaceId: 'ws-1', members: [owner], invites: [invite] }),
    );
    expect(workspaceShareReducer(loaded, closeShareDialog())).toEqual(initialState);
  });

  it('tracks the roster read: requested → loaded, and failed keeps the previous rows', () => {
    const loading = reduce(opened(), shareDataRequested());
    expect(loading.loadStatus).toBe('loading');

    const loaded = reduce(
      loading,
      shareDataLoaded({ workspaceId: 'ws-1', members: [owner], invites: [invite] }),
    );
    expect(loaded).toMatchObject({ loadStatus: 'loaded', loadError: null });
    expect(getItems(loaded.members)).toEqual([owner]);
    expect(getItems(loaded.invites)).toEqual([invite]);
    expect(getItem(loaded.members, 'p-alice')).toEqual(owner);

    const failed = reduce(
      loaded,
      shareDataRequested(),
      shareDataFailed({ workspaceId: 'ws-1', error: 'offline' }),
    );
    expect(failed).toMatchObject({ loadStatus: 'error', loadError: 'offline' });
    expect(getItems(failed.members)).toEqual([owner]);
    expect(getItems(failed.invites)).toEqual([invite]);
  });

  it('ignores a read that settles for a workspace the dialog no longer targets', () => {
    const state = reduce(
      opened(),
      shareDataRequested(),
      shareDataLoaded({ workspaceId: 'ws-stale', members: [owner], invites: [] }),
      shareDataFailed({ workspaceId: 'ws-stale', error: 'nope' }),
    );
    expect(state).toMatchObject({ loadStatus: 'loading', loadError: null });
    expect(getItems(state.members)).toEqual([]);
  });

  it('ignores every settle action once the dialog is closed', () => {
    const state = reduce(
      initialState,
      shareDataRequested(),
      shareDataLoaded({ workspaceId: 'ws-1', members: [owner], invites: [] }),
      shareInviteCreated({ url: 'intent://invite?t=1' }),
      shareActionSettled('late'),
    );
    expect(state).toEqual(initialState);
  });

  it('tracks invite creation: requested → created clears the error and stores the link once', () => {
    const creating = reduce(opened(), shareInviteCreateRequested({ pinLogin: 'dave' }));
    expect(creating).toMatchObject({ creating: true, createError: null });

    const failed = reduce(creating, shareInviteCreateFailed('No GitHub user named @dave'));
    expect(failed).toMatchObject({
      creating: false,
      createError: 'No GitHub user named @dave',
      createdLink: null,
    });

    const created = reduce(
      failed,
      shareInviteCreateRequested({ pinLogin: 'erin' }),
      shareInviteCreated({ url: 'intent://invite?t=2', pinLogin: 'erin' }),
    );
    expect(created).toMatchObject({
      creating: false,
      createError: null,
      createdLink: { url: 'intent://invite?t=2', pinLogin: 'erin' },
    });
  });

  it('tracks one revoke or remove at a time and settles with the daemon error', () => {
    const revoking = reduce(opened(), shareInviteRevokeRequested('inv-1'));
    expect(revoking).toMatchObject({ revokingInviteId: 'inv-1', actionError: null });

    // A second mutation while one is in flight is ignored.
    expect(reduce(revoking, shareMemberRemoveRequested('p-bob'))).toBe(revoking);

    const failed = reduce(revoking, shareActionSettled('forbidden'));
    expect(failed).toMatchObject({
      revokingInviteId: null,
      removingPrincipalId: null,
      actionError: 'forbidden',
    });

    const removed = reduce(failed, shareMemberRemoveRequested('p-bob'), shareActionSettled(null));
    expect(removed).toMatchObject({ removingPrincipalId: null, actionError: null });
  });
});

import { describe, expect, it } from 'vitest';

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import {
  closeShareDialog,
  initialState,
  openShareDialog,
  shareAccessWithheld,
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
  type WorkspaceShareTarget,
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

const target = (state: WorkspaceShareState): WorkspaceShareTarget => ({
  workspaceId: state.workspaceId!,
  session: state.session,
});

const link = { inviteId: 'inv-2', linkHandle: 'invite-link-1', pinLogin: 'erin' };

describe('workspaceShareReducer', () => {
  it('starts closed with no target and no rows', () => {
    expect(initialState).toMatchObject({
      open: false,
      workspaceId: null,
      session: 0,
      loadStatus: 'idle',
      withheld: false,
      creating: false,
      createRequest: 0,
      createdLink: null,
    });
    expect(getItems(initialState.members)).toEqual([]);
    expect(getItems(initialState.invites)).toEqual([]);
  });

  it('openShareDialog records the target workspace and starts a new session', () => {
    expect(opened()).toEqual({
      ...initialState,
      open: true,
      workspaceId: 'ws-1',
      workspaceTitle: 'My Space',
      session: 1,
    });
  });

  it('openShareDialog retargets an already-open dialog and drops the previous rows', () => {
    const loaded = reduce(
      opened(),
      shareDataLoaded({ target: target(opened()), members: [owner], invites: [invite] }),
      shareInviteCreateRequested({ pinLogin: '' }),
      shareInviteCreated({ target: target(opened()), request: 1, link }),
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
      session: 2,
    });
  });

  it('closeShareDialog resets everything but keeps the session counter monotonic', () => {
    const loaded = reduce(
      opened(),
      shareDataLoaded({ target: target(opened()), members: [owner], invites: [invite] }),
    );
    const closed = workspaceShareReducer(loaded, closeShareDialog());
    expect(closed).toEqual({ ...initialState, session: 1 });
    expect(
      workspaceShareReducer(closed, openShareDialog({ workspaceId: 'ws-1', workspaceTitle: '' }))
        .session,
    ).toBe(2);
  });

  it('tracks the roster read: requested → loaded, and failed keeps the previous rows', () => {
    const loading = reduce(opened(), shareDataRequested());
    expect(loading.loadStatus).toBe('loading');

    const loaded = reduce(
      loading,
      shareDataLoaded({ target: target(loading), members: [owner], invites: [invite] }),
    );
    expect(loaded).toMatchObject({ loadStatus: 'loaded', loadError: null });
    expect(getItems(loaded.members)).toEqual([owner]);
    expect(getItems(loaded.invites)).toEqual([invite]);
    expect(getItem(loaded.members, 'p-alice')).toEqual(owner);

    const failed = reduce(
      loaded,
      shareDataRequested(),
      shareDataFailed({ target: target(loaded), error: 'offline' }),
    );
    expect(failed).toMatchObject({ loadStatus: 'error', loadError: 'offline' });
    expect(getItems(failed.members)).toEqual([owner]);
    expect(getItems(failed.invites)).toEqual([invite]);
  });

  it('ignores a read that settles for a workspace the dialog no longer targets', () => {
    const state = reduce(
      opened(),
      shareDataRequested(),
      shareDataLoaded({
        target: { workspaceId: 'ws-stale', session: 1 },
        members: [owner],
        invites: [],
      }),
      shareDataFailed({ target: { workspaceId: 'ws-stale', session: 1 }, error: 'nope' }),
    );
    expect(state).toMatchObject({ loadStatus: 'loading', loadError: null });
    expect(getItems(state.members)).toEqual([]);
  });

  it('ignores every settle action once the dialog is closed', () => {
    const stale = { workspaceId: 'ws-1', session: 0 };
    const state = reduce(
      initialState,
      shareDataRequested(),
      shareDataLoaded({ target: stale, members: [owner], invites: [] }),
      shareInviteCreated({ target: stale, request: 0, link }),
      shareActionSettled({ target: stale, error: 'late' }),
    );
    expect(state).toEqual(initialState);
  });

  // Regression (fe#2440 review P1): a delayed `workspace.invite.create` reply
  // for workspace A must never attach its link once the dialog was closed and
  // reopened for workspace B — same workspace id, different session, or a
  // superseded create request are all dropped.
  it('drops an invite created for a previous dialog session or a superseded request', () => {
    const sessionA = reduce(opened(), shareInviteCreateRequested({ pinLogin: '' }));
    const targetA = target(sessionA);
    const reopenedForB = reduce(
      sessionA,
      closeShareDialog(),
      openShareDialog({ workspaceId: 'ws-2', workspaceTitle: 'B' }),
    );
    expect(reduce(reopenedForB, shareInviteCreated({ target: targetA, request: 1, link }))).toBe(
      reopenedForB,
    );

    const reopenedForA = reduce(
      sessionA,
      closeShareDialog(),
      openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'A' }),
    );
    expect(reduce(reopenedForA, shareInviteCreated({ target: targetA, request: 1, link }))).toBe(
      reopenedForA,
    );

    const second = reduce(sessionA, shareInviteCreateRequested({ pinLogin: 'x' }));
    expect(second.createRequest).toBe(2);
    expect(reduce(second, shareInviteCreated({ target: target(second), request: 1, link }))).toBe(
      second,
    );
    expect(
      reduce(second, shareInviteCreateFailed({ target: target(second), request: 1, error: 'old' })),
    ).toBe(second);
    const current = reduce(
      second,
      shareInviteCreated({ target: target(second), request: 2, link }),
    );
    expect(current).toMatchObject({ creating: false, createdLink: link });
  });

  it('tracks invite creation: requested → created clears the error and stores the link handle', () => {
    const creating = reduce(opened(), shareInviteCreateRequested({ pinLogin: 'dave' }));
    expect(creating).toMatchObject({ creating: true, createError: null, createRequest: 1 });

    const failed = reduce(
      creating,
      shareInviteCreateFailed({
        target: target(creating),
        request: 1,
        error: 'No GitHub user named @dave',
      }),
    );
    expect(failed).toMatchObject({
      creating: false,
      createError: 'No GitHub user named @dave',
      createdLink: null,
    });

    const created = reduce(
      failed,
      shareInviteCreateRequested({ pinLogin: 'erin' }),
      shareInviteCreated({ target: target(failed), request: 2, link }),
    );
    expect(created).toMatchObject({ creating: false, createError: null, createdLink: link });
    // The store holds a handle only — never the url / secret.
    expect(JSON.stringify(created)).not.toContain('intent://');
  });

  // Regression (fe#2440 review P2): a local revoke of the just-created invite
  // retires the one-time link at once, and so does a re-read that no longer
  // lists it (revoked / redeemed from another client).
  it('retires the created link when its invite is revoked locally or vanishes from the list', () => {
    const created = reduce(
      opened(),
      shareInviteCreateRequested({ pinLogin: '' }),
      shareInviteCreated({ target: target(opened()), request: 1, link }),
      shareDataLoaded({
        target: target(opened()),
        members: [owner],
        invites: [invite, { ...invite, id: 'inv-2' }],
      }),
    );
    expect(created.createdLink).toEqual(link);

    const otherRevoked = reduce(
      created,
      shareInviteRevokeRequested('inv-1'),
      shareActionSettled({ target: target(created), error: null, revokedInviteId: 'inv-1' }),
    );
    expect(otherRevoked.createdLink).toEqual(link);

    const revoked = reduce(
      created,
      shareInviteRevokeRequested('inv-2'),
      shareActionSettled({ target: target(created), error: null, revokedInviteId: 'inv-2' }),
    );
    expect(revoked.createdLink).toBeNull();

    const vanished = reduce(
      created,
      shareDataLoaded({ target: target(created), members: [owner], invites: [invite] }),
    );
    expect(vanished.createdLink).toBeNull();
  });

  // Regression (fe#2440 review P1): a `-32003` refusal (or a non-owner
  // caller) withholds the dialog — rows dropped, controls gone, and every
  // later mutation or settlement for that session is ignored.
  it('shareAccessWithheld drops the rows and blocks further mutations', () => {
    const loaded = reduce(
      opened(),
      shareDataLoaded({ target: target(opened()), members: [owner], invites: [invite] }),
      shareInviteCreateRequested({ pinLogin: '' }),
      shareInviteCreated({ target: target(opened()), request: 1, link }),
    );
    const withheld = reduce(loaded, shareAccessWithheld({ target: target(loaded) }));
    expect(withheld).toMatchObject({
      open: true,
      withheld: true,
      loadStatus: 'loaded',
      creating: false,
      createdLink: null,
    });
    expect(getItems(withheld.members)).toEqual([]);
    expect(getItems(withheld.invites)).toEqual([]);

    expect(reduce(withheld, shareDataRequested())).toBe(withheld);
    expect(reduce(withheld, shareInviteCreateRequested({ pinLogin: '' }))).toBe(withheld);
    expect(reduce(withheld, shareInviteRevokeRequested('inv-1'))).toBe(withheld);
    expect(reduce(withheld, shareMemberRemoveRequested('p-bob'))).toBe(withheld);
    expect(
      reduce(
        withheld,
        shareDataLoaded({ target: target(withheld), members: [owner], invites: [] }),
      ),
    ).toBe(withheld);

    // Reopening clears the withheld flag.
    expect(
      reduce(withheld, openShareDialog({ workspaceId: 'ws-1', workspaceTitle: '' })).withheld,
    ).toBe(false);
    // A stale withhold for another session is ignored.
    expect(
      reduce(loaded, shareAccessWithheld({ target: { workspaceId: 'ws-1', session: 0 } })),
    ).toBe(loaded);
  });

  it('tracks one revoke or remove at a time and settles with the localized error', () => {
    const revoking = reduce(opened(), shareInviteRevokeRequested('inv-1'));
    expect(revoking).toMatchObject({ revokingInviteId: 'inv-1', actionError: null });

    // A second mutation while one is in flight is ignored.
    expect(reduce(revoking, shareMemberRemoveRequested('p-bob'))).toBe(revoking);

    const failed = reduce(
      revoking,
      shareActionSettled({ target: target(revoking), error: 'Could not revoke the invite' }),
    );
    expect(failed).toMatchObject({
      revokingInviteId: null,
      removingPrincipalId: null,
      actionError: 'Could not revoke the invite',
    });

    const removed = reduce(
      failed,
      shareMemberRemoveRequested('p-bob'),
      shareActionSettled({ target: target(failed), error: null }),
    );
    expect(removed).toMatchObject({ removingPrincipalId: null, actionError: null });
  });
});

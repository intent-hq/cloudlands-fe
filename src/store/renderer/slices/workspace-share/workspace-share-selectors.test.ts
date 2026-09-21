/**
 * Hover-card roster selectors: the owner gate (`workspace.myRole === 'owner'`
 * in a settled owner window and not withheld by the daemon) and the keyed
 * roster reads, as pure state-in / value-out cases.
 */
import { describe, expect, it } from 'vitest';

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { HostPrincipal, WorkspaceMember } from '$features/workspace-sharing/types';
import type { Workspace, WorkspaceRole } from '$shared/types';
import type { StoreState } from '../../types';
import {
  connectionsListReceived,
  connectionsReducer,
  initialState as connectionsInitialState,
} from '../connections/connections-slice';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  initialState as guestSessionsInitialState,
} from '../guest-sessions/guest-sessions-slice';
import type { GuestSessionRecord } from '../guest-sessions/guest-sessions-types';
import {
  selectShareCanManage,
  selectShareInvitablePrincipals,
  selectWorkspaceRosterCanManage,
  selectWorkspaceRosterMembers,
  selectWorkspaceRosterRemoveError,
  selectWorkspaceRosterRemovingPrincipalId,
  selectWorkspaceRosterTracked,
  selectWorkspaceRosterWithheld,
} from './workspace-share-selectors';
import {
  initialState,
  openShareDialog,
  shareDataLoaded,
  sharePrincipalsLoaded,
  shareRosterLoaded,
  shareRosterMemberRemoveRequested,
  shareRosterRequested,
  shareRosterWithheld,
  workspaceShareReducer,
} from './workspace-share-slice';

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};
const guest: WorkspaceMember = { ...owner, principalId: 'p-guest', role: 'collaborator' };

/** Settled owner window: the guest list arrived with no host joined. */
function stateWith(
  roles: Record<string, WorkspaceRole | undefined>,
  ...actions: Parameters<typeof workspaceShareReducer>[1][]
): StoreState {
  const workspaces = Object.entries(roles).map(
    ([id, myRole]) => ({ id, title: id, myRole }) as unknown as Workspace,
  );
  return {
    workspaceShare: actions.reduce(workspaceShareReducer, initialState),
    workspace: { workspaces: createCollection('id', workspaces) },
    connections: connectionsInitialState,
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }),
    ),
  } as unknown as StoreState;
}

const GUEST_SESSION: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.5',
  hosts: ['10.0.0.5'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'prin-guest',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

/** Bind the window to the joined host `GUEST_SESSION` (multiplayer w4). */
function guestWindow(state: StoreState): StoreState {
  return {
    ...state,
    connections: connectionsReducer(
      connectionsInitialState,
      connectionsListReceived({
        connections: [],
        activeId: GUEST_SESSION.id,
        windowBackendId: GUEST_SESSION.id,
      }),
    ),
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [GUEST_SESSION], openIds: [], connectedIds: [] }),
    ),
  };
}

/** Nothing hydrated yet: the window's guest/owner identity is the boot-time default. */
function unsettled(state: StoreState): StoreState {
  return {
    ...state,
    connections: connectionsInitialState,
    guestSessions: guestSessionsInitialState,
  };
}

const loaded = [
  shareRosterRequested({ workspaceId: 'ws-1' }),
  shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
];

describe('selectWorkspaceRosterCanManage', () => {
  it('is true only for the owner of a workspace the daemon has not withheld', () => {
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'owner' }), 'ws-1')).toBe(
      true,
    );
    expect(
      selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'collaborator' }), 'ws-1'),
    ).toBe(false);
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': undefined }), 'ws-1')).toBe(
      false,
    );
    expect(selectWorkspaceRosterCanManage.select(stateWith({}), 'ws-1')).toBe(false);
    expect(selectWorkspaceRosterCanManage.select(stateWith({ 'ws-1': 'owner' }), undefined)).toBe(
      false,
    );
  });

  it('turns false for the owner once the daemon refused an owner-only method', () => {
    const state = stateWith(
      { 'ws-1': 'owner', 'ws-2': 'owner' },
      ...loaded,
      shareRosterWithheld({ workspaceId: 'ws-1' }),
    );
    expect(selectWorkspaceRosterCanManage.select(state, 'ws-1')).toBe(false);
    expect(selectWorkspaceRosterWithheld.select(state, 'ws-1')).toBe(true);
    expect(selectWorkspaceRosterCanManage.select(state, 'ws-2')).toBe(true);
    expect(selectWorkspaceRosterWithheld.select(state, 'ws-2')).toBe(false);
  });

  it('is false in a guest window even when the daemon reports myRole owner (host owner joined its own invite)', () => {
    expect(
      selectWorkspaceRosterCanManage.select(guestWindow(stateWith({ 'ws-1': 'owner' })), 'ws-1'),
    ).toBe(false);
  });

  it('is false until the window identity settles, even when the row reports myRole owner', () => {
    expect(
      selectWorkspaceRosterCanManage.select(unsettled(stateWith({ 'ws-1': 'owner' })), 'ws-1'),
    ).toBe(false);
  });
});

describe('selectShareCanManage', () => {
  const dialog = openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'ws-1' });

  it('is true only for the owner of the open dialog workspace in a settled owner window', () => {
    expect(selectShareCanManage.select(stateWith({ 'ws-1': 'owner' }, dialog))).toBe(true);
    expect(selectShareCanManage.select(stateWith({ 'ws-1': 'collaborator' }, dialog))).toBe(false);
    expect(selectShareCanManage.select(stateWith({ 'ws-1': undefined }, dialog))).toBe(false);
    expect(selectShareCanManage.select(stateWith({ 'ws-1': 'owner' }))).toBe(false);
  });

  it('fails closed in a guest window and until the window identity settles, whatever myRole the row carries', () => {
    expect(selectShareCanManage.select(guestWindow(stateWith({ 'ws-1': 'owner' }, dialog)))).toBe(
      false,
    );
    expect(selectShareCanManage.select(unsettled(stateWith({ 'ws-1': 'owner' }, dialog)))).toBe(
      false,
    );
  });
});

describe('selectShareInvitablePrincipals', () => {
  it('lists the host principals not yet on the dialog roster, in daemon order', () => {
    const erin: HostPrincipal = {
      principalId: 'p-erin',
      login: 'erin',
      displayName: null,
      avatarUrl: null,
      githubUserId: 5,
    };
    const alreadyMember: HostPrincipal = { ...erin, principalId: 'p-guest', login: 'guest' };
    const frank: HostPrincipal = { ...erin, principalId: 'p-frank', login: 'frank' };
    const target = { workspaceId: 'ws-1', session: 1 };
    const state = stateWith(
      { 'ws-1': 'owner' },
      openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'ws-1' }),
      shareDataLoaded({
        target,
        generation: 0,
        members: [owner, guest],
        invites: [],
        guestCount: null,
        guestLimit: null,
      }),
      sharePrincipalsLoaded({ target, principals: [erin, alreadyMember, frank] }),
    );
    expect(selectShareInvitablePrincipals.select(state)).toEqual([erin, frank]);
  });
});

describe('keyed roster reads', () => {
  it('reads the rows, in-flight removal, and error of the named workspace only', () => {
    const state = stateWith(
      { 'ws-1': 'owner' },
      ...loaded,
      shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }),
    );
    expect(selectWorkspaceRosterMembers.select(state, 'ws-1').map((m) => m.principalId)).toEqual([
      'p-alice',
      'p-guest',
    ]);
    expect(selectWorkspaceRosterMembers.select(state, 'ws-2')).toEqual([]);
    expect(selectWorkspaceRosterMembers.select(state, undefined)).toEqual([]);
    expect(selectWorkspaceRosterRemovingPrincipalId.select(state, 'ws-1')).toBe('p-guest');
    expect(selectWorkspaceRosterRemovingPrincipalId.select(state, 'ws-2')).toBeNull();
    expect(selectWorkspaceRosterRemoveError.select(state, 'ws-1')).toBeNull();
    expect(selectWorkspaceRosterTracked.select(state, 'ws-1')).toBe(true);
    expect(selectWorkspaceRosterTracked.select(state, 'ws-2')).toBe(false);
  });
});

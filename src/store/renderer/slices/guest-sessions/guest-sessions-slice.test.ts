import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  hostedRosterFailed,
  hostedRosterLoading,
  hostedRosterReceived,
  initialState,
  leaveOperationSettled,
  leaveOperationStarted,
  removeMemberOperationSettled,
  removeMemberOperationStarted,
} from './guest-sessions-slice';
import { hostedMemberKey, type WorkspaceMember } from './guest-sessions-types';

const GUEST: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.7',
  hosts: ['10.0.0.7'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'principal-1',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

const MEMBER: WorkspaceMember = {
  principalId: 'principal-2',
  login: 'hubot',
  displayName: 'Hubot',
  avatarUrl: null,
  role: 'collaborator',
  addedAt: '2026-09-14T00:00:00Z',
};

describe('guestSessionsReducer', () => {
  it('starts with no sessions and no hydration', () => {
    const state = guestSessionsReducer(undefined, { type: '@@INIT' });
    expect(getItems(state.sessions)).toEqual([]);
    expect(state.hasReceivedList).toBe(false);
    expect(state.connectedIds).toEqual([]);
    expect(state.hostedRosters).toEqual({});
  });

  it('replaces the list and connectivity from a list payload and marks hydration', () => {
    const state = guestSessionsReducer(
      initialState,
      guestSessionsListReceived({ sessions: [GUEST], connectedIds: [GUEST.id] }),
    );
    expect(getItems(state.sessions)).toEqual([GUEST]);
    expect(state.connectedIds).toEqual([GUEST.id]);
    expect(state.hasReceivedList).toBe(true);

    const next = guestSessionsReducer(
      state,
      guestSessionsListReceived({ sessions: [], connectedIds: [] }),
    );
    expect(getItems(next.sessions)).toEqual([]);
    expect(next.connectedIds).toEqual([]);
  });

  it('tracks a leave in flight once per id', () => {
    let state = guestSessionsReducer(initialState, leaveOperationStarted(GUEST.id));
    state = guestSessionsReducer(state, leaveOperationStarted(GUEST.id));
    expect(state.leavingIds).toEqual([GUEST.id]);
    state = guestSessionsReducer(state, leaveOperationSettled(GUEST.id));
    expect(state.leavingIds).toEqual([]);
  });

  it('moves a roster through loading → loaded and keeps stale members while reloading', () => {
    let state = guestSessionsReducer(initialState, hostedRosterLoading('ws-1'));
    expect(state.hostedRosters['ws-1']).toEqual({ status: 'loading', members: [] });
    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', [MEMBER]));
    expect(state.hostedRosters['ws-1']).toEqual({ status: 'loaded', members: [MEMBER] });
    state = guestSessionsReducer(state, hostedRosterLoading('ws-1'));
    expect(state.hostedRosters['ws-1']).toEqual({ status: 'loading', members: [MEMBER] });
    state = guestSessionsReducer(state, hostedRosterFailed('ws-1'));
    expect(state.hostedRosters['ws-1']).toEqual({ status: 'error', members: [MEMBER] });
  });

  it('tracks a member removal in flight by workspace + principal', () => {
    const key = hostedMemberKey('ws-1', MEMBER.principalId);
    let state = guestSessionsReducer(
      initialState,
      removeMemberOperationStarted('ws-1', MEMBER.principalId),
    );
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-1', MEMBER.principalId));
    expect(state.removingMemberKeys).toEqual([key]);
    state = guestSessionsReducer(state, removeMemberOperationSettled('ws-1', MEMBER.principalId));
    expect(state.removingMemberKeys).toEqual([]);
  });
});

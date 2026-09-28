import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import { removeWorkspaceEntity, resetWorkspaceState } from '../workspace/workspace-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  guestSessionsListReceived,
  guestSessionsListUnavailable,
  guestSessionsReducer,
  hostedRosterFailed,
  hostedRosterLoading,
  hostedRosterReceived,
  hostedRosterWithheld,
  hostedSweepReportReceived,
  leaveGuestSessionRequested,
  leaveGuestWorkspaceRequested,
  removeHostedMemberRequested,
  initialState,
  leaveOperationSettled,
  leaveOperationStarted,
  leaveWorkspaceOperationSettled,
  leaveWorkspaceOperationStarted,
  removeAllGuestsOperationSettled,
  removeAllGuestsOperationStarted,
  removeMemberOperationSettled,
  removeMemberOperationStarted,
} from './guest-sessions-slice';
import {
  GuestSessionOperationError,
  HostedRosterOperationError,
  guestWorkspaceKey,
  hostedMemberKey,
  type WorkspaceMember,
} from './guest-sessions-types';

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
  workspaces: [{ id: 'ws-guest', title: 'Guest project' }],
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
  it('keeps retry targets independent and clears only the operation being retried', () => {
    const failed = leaveGuestSessionRequested('guest-1');
    const other = leaveGuestSessionRequested('guest-2');
    let state = guestSessionsReducer(
      initialState,
      failed.failure(new GuestSessionOperationError('ipc')),
    );
    state = guestSessionsReducer(state, other.failure(new GuestSessionOperationError('ipc')));
    state = guestSessionsReducer(state, leaveOperationStarted('guest-1'));
    expect(state.failedLeaveIds).toEqual(['guest-2']);
    expect(state.leavingIds).toEqual(['guest-1']);
    const perWorkspace = leaveGuestWorkspaceRequested('guest-1', 'ws-1');
    state = guestSessionsReducer(
      state,
      perWorkspace.failure(new GuestSessionOperationError('ipc')),
    );
    expect(state.failedLeaveWorkspaceKeys).toEqual([guestWorkspaceKey('guest-1', 'ws-1')]);
    state = guestSessionsReducer(state, leaveWorkspaceOperationStarted('guest-1', 'ws-1'));
    expect(state.failedLeaveWorkspaceKeys).toEqual([]);
    expect(state.failedLeaveIds).toEqual(['guest-2']);
  });

  it('keeps failed members independent when retrying another removal', () => {
    const first = removeHostedMemberRequested('ws-1', 'principal-1');
    const second = removeHostedMemberRequested('ws-1', 'principal-2');
    let state = guestSessionsReducer(
      initialState,
      first.failure(new HostedRosterOperationError('transport')),
    );
    state = guestSessionsReducer(
      state,
      second.failure(new HostedRosterOperationError('transport')),
    );
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-1', 'principal-1'));
    expect(state.failedMemberKeys).toEqual([hostedMemberKey('ws-1', 'principal-2')]);
    expect(state.removingMemberKeys).toEqual([hostedMemberKey('ws-1', 'principal-1')]);
  });

  it('forgets a removed membership failure before the same principal joins again', () => {
    const removal = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    let state = guestSessionsReducer(initialState, hostedRosterReceived('ws-1', [MEMBER]));
    state = guestSessionsReducer(
      state,
      removal.failure(new HostedRosterOperationError('transport')),
    );
    expect(state.failedMemberKeys).toEqual([hostedMemberKey('ws-1', MEMBER.principalId)]);

    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', []));
    expect(state.failedMemberKeys).toEqual([]);
    state = guestSessionsReducer(
      state,
      hostedRosterReceived('ws-1', [{ ...MEMBER, addedAt: '2026-09-24T00:00:00Z' }]),
    );
    expect(state.failedMemberKeys).toEqual([]);
  });

  it('prunes only absent members while retaining current failures and independent workspace retries', () => {
    const remaining = { ...MEMBER, principalId: 'principal-3' };
    let state = guestSessionsReducer(
      initialState,
      hostedRosterReceived('ws-1', [MEMBER, remaining]),
    );
    state = guestSessionsReducer(state, hostedRosterReceived('ws-10', [MEMBER]));
    for (const [workspaceId, principalId] of [
      ['ws-1', MEMBER.principalId],
      ['ws-1', remaining.principalId],
      ['ws-10', MEMBER.principalId],
    ]) {
      const removal = removeHostedMemberRequested(workspaceId, principalId);
      state = guestSessionsReducer(
        state,
        removal.failure(new HostedRosterOperationError('transport')),
      );
    }
    const failures = state.failedMemberKeys;
    state = guestSessionsReducer(state, hostedRosterLoading('ws-1'));
    state = guestSessionsReducer(state, hostedRosterFailed('ws-1'));
    expect(state.failedMemberKeys).toBe(failures);
    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', [MEMBER, remaining]));
    expect(state.failedMemberKeys).toBe(failures);

    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', [remaining]));
    expect(state.failedMemberKeys).toEqual([
      hostedMemberKey('ws-1', remaining.principalId),
      hostedMemberKey('ws-10', MEMBER.principalId),
    ]);
    state = guestSessionsReducer(
      state,
      removeMemberOperationStarted('ws-1', remaining.principalId),
    );
    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', [remaining]));
    expect(state.failedMemberKeys).toEqual([hostedMemberKey('ws-10', MEMBER.principalId)]);
    expect(state.removingMemberKeys).toEqual([hostedMemberKey('ws-1', remaining.principalId)]);
  });

  it('does not offer retry for cancelled leaves or forbidden/cancelled member removals', () => {
    const leave = leaveGuestSessionRequested('guest-1');
    expect(
      guestSessionsReducer(
        initialState,
        leave.failure(new GuestSessionOperationError('cancelled')),
      ),
    ).toBe(initialState);
    const member = removeHostedMemberRequested('ws-1', MEMBER.principalId);
    for (const code of ['cancelled', 'forbidden'] as const) {
      expect(
        guestSessionsReducer(initialState, member.failure(new HostedRosterOperationError(code))),
      ).toBe(initialState);
    }
    let state = guestSessionsReducer(
      initialState,
      member.failure(new HostedRosterOperationError('transport')),
    );
    expect(state.failedMemberKeys).toEqual([hostedMemberKey('ws-1', MEMBER.principalId)]);
    state = guestSessionsReducer(state, hostedRosterWithheld('ws-1'));
    expect(state.failedMemberKeys).toEqual([]);
    expect(
      guestSessionsReducer(state, member.failure(new HostedRosterOperationError('transport'))),
    ).toBe(state);
  });

  it('retains sweep reports across list refreshes, but drops them on retry, deletion, or backend reset', () => {
    const report = {
      workspaceId: 'ws-1',
      workspaceTitle: 'Project',
      memberLabels: { p: 'Guest' },
      failedMemberIds: ['p'],
      failedInviteLabels: [],
      invitesUnavailable: true,
    };
    let state = guestSessionsReducer(initialState, hostedSweepReportReceived(report));
    state = guestSessionsReducer(state, hostedRosterReceived('ws-1', []));
    expect(getItems(state.sweepReports)).toEqual([report]);
    expect(
      getItems(guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-1')).sweepReports),
    ).toEqual([]);
    expect(getItems(guestSessionsReducer(state, workspaceDeleted('ws-1')).sweepReports)).toEqual(
      [],
    );
    expect(getItems(guestSessionsReducer(state, resetWorkspaceState()).sweepReports)).toEqual([]);
  });

  it('starts with no sessions and no hydration', () => {
    const state = guestSessionsReducer(undefined, { type: '@@INIT' });
    expect(getItems(state.sessions)).toEqual([]);
    expect(state.hasReceivedList).toBe(false);
    expect(state.openIds).toEqual([]);
    expect(state.connectedIds).toEqual([]);
    expect(state.hostedRosters).toEqual({});
  });

  it('replaces the list, pool presence and connectivity from a list payload and marks hydration', () => {
    const state = guestSessionsReducer(
      initialState,
      guestSessionsListReceived({
        sessions: [GUEST],
        openIds: [GUEST.id],
        connectedIds: [GUEST.id],
      }),
    );
    expect(getItems(state.sessions)).toEqual([GUEST]);
    expect(state.openIds).toEqual([GUEST.id]);
    expect(state.connectedIds).toEqual([GUEST.id]);
    expect(state.hasReceivedList).toBe(true);

    const next = guestSessionsReducer(
      state,
      guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }),
    );
    expect(getItems(next.sessions)).toEqual([]);
    expect(next.openIds).toEqual([]);
    expect(next.connectedIds).toEqual([]);
  });

  it('marks the list unavailable without pretending it hydrated, until a list payload lands', () => {
    const state = guestSessionsReducer(initialState, guestSessionsListUnavailable());
    expect(state.listUnavailable).toBe(true);
    expect(state.hasReceivedList).toBe(false);
    expect(guestSessionsReducer(state, guestSessionsListUnavailable())).toBe(state);

    const next = guestSessionsReducer(
      state,
      guestSessionsListReceived({ sessions: [GUEST], openIds: [], connectedIds: [] }),
    );
    expect(next.listUnavailable).toBe(false);
    expect(next.hasReceivedList).toBe(true);
  });

  it('tracks a leave in flight once per id', () => {
    let state = guestSessionsReducer(initialState, leaveOperationStarted(GUEST.id));
    state = guestSessionsReducer(state, leaveOperationStarted(GUEST.id));
    expect(state.leavingIds).toEqual([GUEST.id]);
    state = guestSessionsReducer(state, leaveOperationSettled(GUEST.id));
    expect(state.leavingIds).toEqual([]);
  });

  it('tracks a per-workspace leave in flight once per host + workspace', () => {
    const key = guestWorkspaceKey(GUEST.id, 'ws-guest');
    let state = guestSessionsReducer(
      initialState,
      leaveWorkspaceOperationStarted(GUEST.id, 'ws-guest'),
    );
    state = guestSessionsReducer(state, leaveWorkspaceOperationStarted(GUEST.id, 'ws-guest'));
    expect(state.leavingWorkspaceKeys).toEqual([key]);
    state = guestSessionsReducer(state, leaveWorkspaceOperationStarted(GUEST.id, 'ws-other'));
    state = guestSessionsReducer(state, leaveWorkspaceOperationSettled(GUEST.id, 'ws-guest'));
    expect(state.leavingWorkspaceKeys).toEqual([guestWorkspaceKey(GUEST.id, 'ws-other')]);
    // The host-level leave marker is separate.
    expect(state.leavingIds).toEqual([]);
  });

  it('tracks a Remove all guests sweep in flight once per workspace', () => {
    let state = guestSessionsReducer(initialState, removeAllGuestsOperationStarted('ws-1'));
    state = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-1'));
    expect(state.clearingWorkspaceIds).toEqual(['ws-1']);
    state = guestSessionsReducer(state, removeAllGuestsOperationSettled('ws-1'));
    expect(state.clearingWorkspaceIds).toEqual([]);
    expect(guestSessionsReducer(state, removeAllGuestsOperationSettled('ws-1'))).toBe(state);
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

  it('withholding a roster drops its cached rows and in-flight removal / sweep markers', () => {
    let state = guestSessionsReducer(initialState, hostedRosterReceived('ws-1', [MEMBER]));
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-1', MEMBER.principalId));
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-2', MEMBER.principalId));
    state = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-1'));
    state = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-2'));
    state = guestSessionsReducer(state, hostedRosterWithheld('ws-1'));
    expect(state.hostedRosters['ws-1']).toEqual({ status: 'withheld', members: [] });
    expect(state.removingMemberKeys).toEqual([hostedMemberKey('ws-2', MEMBER.principalId)]);
    expect(state.clearingWorkspaceIds).toEqual(['ws-2']);
  });

  it('a withheld roster is terminal: a late load, result or failure leaves it untouched until purged', () => {
    const withheld = guestSessionsReducer(initialState, hostedRosterWithheld('ws-1'));
    expect(guestSessionsReducer(withheld, hostedRosterLoading('ws-1'))).toBe(withheld);
    expect(guestSessionsReducer(withheld, hostedRosterReceived('ws-1', [MEMBER]))).toBe(withheld);
    expect(guestSessionsReducer(withheld, hostedRosterFailed('ws-1'))).toBe(withheld);
    expect(guestSessionsReducer(withheld, hostedRosterWithheld('ws-1'))).toBe(withheld);

    // Another workspace is unaffected.
    const other = guestSessionsReducer(withheld, hostedRosterReceived('ws-2', [MEMBER]));
    expect(other.hostedRosters).toEqual({
      'ws-1': { status: 'withheld', members: [] },
      'ws-2': { status: 'loaded', members: [MEMBER] },
    });

    // Purging ends it: the next read starts over.
    const purged = guestSessionsReducer(withheld, workspaceDeleted('ws-1', []));
    expect(
      guestSessionsReducer(purged, hostedRosterReceived('ws-1', [MEMBER])).hostedRosters,
    ).toEqual({ 'ws-1': { status: 'loaded', members: [MEMBER] } });
  });

  it('purges a roster and its removal / sweep markers when the workspace is deleted or its entity removed', () => {
    let state = guestSessionsReducer(initialState, hostedRosterReceived('ws-1', [MEMBER]));
    state = guestSessionsReducer(state, hostedRosterReceived('ws-2', [MEMBER]));
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-1', MEMBER.principalId));
    state = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-1'));
    state = guestSessionsReducer(state, workspaceDeleted('ws-1', []));
    expect(state.hostedRosters).toEqual({ 'ws-2': { status: 'loaded', members: [MEMBER] } });
    expect(state.removingMemberKeys).toEqual([]);
    expect(state.clearingWorkspaceIds).toEqual([]);

    const unrelated = guestSessionsReducer(state, workspaceDeleted('ws-none', []));
    expect(unrelated).toBe(state);

    // A sweep marker without a roster entry is purged too.
    const markerOnly = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-3'));
    expect(
      guestSessionsReducer(markerOnly, workspaceDeleted('ws-3', [])).clearingWorkspaceIds,
    ).toEqual([]);

    state = guestSessionsReducer(state, removeWorkspaceEntity('ws-2'));
    expect(state.hostedRosters).toEqual({});
  });

  it('drops every roster and sweep marker when the window workspace list is reset', () => {
    let state = guestSessionsReducer(initialState, hostedRosterReceived('ws-1', [MEMBER]));
    state = guestSessionsReducer(state, removeMemberOperationStarted('ws-1', MEMBER.principalId));
    state = guestSessionsReducer(state, removeAllGuestsOperationStarted('ws-1'));
    state = guestSessionsReducer(state, resetWorkspaceState());
    expect(state.hostedRosters).toEqual({});
    expect(state.removingMemberKeys).toEqual([]);
    expect(state.clearingWorkspaceIds).toEqual([]);
    expect(guestSessionsReducer(state, resetWorkspaceState())).toBe(state);
  });
});

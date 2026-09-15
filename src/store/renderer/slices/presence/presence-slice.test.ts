import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import type { PresenceMember, PresenceRoster, PresenceTypingEntry } from '$shared/types/presence';
import type { WorkspaceRole } from '$shared/types';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';
import {
  initialState,
  presenceMembersReceived,
  presenceOwnPrincipalReceived,
  presenceOwnTypingSourceReceived,
  presenceReducer,
  presenceReset,
  presenceRosterReceived,
  presenceSnapshotReceived,
  presenceTypingExpired,
  presenceTypingPulse,
  presenceTypingStopped,
  presenceWindowVisibilityChanged,
} from './presence-slice';

const member = (principalId: string, overrides: Partial<PresenceMember> = {}): PresenceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  focus: [{ workspaceId: 'ws-1' }],
  typing: [],
  ...overrides,
});

const roster = (members: PresenceMember[], workspaceId = 'ws-1'): PresenceRoster => ({
  workspaceId,
  members,
});

const typing = (source: string, pulse: number, agentId = 'agent-1'): PresenceTypingEntry => ({
  source,
  agentId,
  since: '2026-09-14T12:00:00Z',
  pulse,
});

const accepted = (principalId: string, role: WorkspaceRole = 'collaborator'): WorkspaceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  role,
  addedAt: '2026-09-14T12:00:00Z',
});

describe('presence slice', () => {
  it('starts empty and visible', () => {
    expect(presenceReducer(undefined, { type: '@@init' })).toEqual(initialState);
    expect(initialState.windowVisible).toBe(true);
  });

  it('replaces a workspace roster and keeps other workspaces', () => {
    let state = presenceReducer(initialState, presenceRosterReceived(roster([member('a')])));
    state = presenceReducer(state, presenceRosterReceived(roster([member('b')], 'ws-2')));
    state = presenceReducer(state, presenceRosterReceived(roster([member('c')])));
    expect(getItems(state.rosters['ws-1']).map((m) => m.principalId)).toEqual(['c']);
    expect(getItems(state.rosters['ws-2']).map((m) => m.principalId)).toEqual(['b']);
    expect(getItem(state.rosters['ws-1'], 'a')).toBeUndefined();
    expect(getItem(state.rosters['ws-1'], 'c')?.principalId).toBe('c');
  });

  it('applies a fenced snapshot exactly like a pushed roster, typing included', () => {
    const pushed = presenceReducer(
      initialState,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 1)] })])),
    );
    const snapshotted = presenceReducer(
      initialState,
      presenceSnapshotReceived(roster([member('a', { typing: [typing('ts-1', 1)] })])),
    );
    expect(snapshotted).toEqual(pushed);
    expect(presenceSnapshotReceived.type).not.toBe(presenceRosterReceived.type);
  });

  it('folds typing entries by source, keeping identity while the pulse is unchanged', () => {
    const first = presenceReducer(
      initialState,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 1)] })])),
    );
    const entry = first.liveTyping['ws-1']['ts-1'];
    expect(entry).toEqual({ principalId: 'a', agentId: 'agent-1', pulse: 1, expired: false });

    const same = presenceReducer(
      first,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 1)] })])),
    );
    expect(same.liveTyping['ws-1']['ts-1']).toBe(entry);

    const advanced = presenceReducer(
      same,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 2)] })])),
    );
    expect(advanced.liveTyping['ws-1']['ts-1']).not.toBe(entry);
    expect(advanced.liveTyping['ws-1']['ts-1'].pulse).toBe(2);
  });

  it('drops typing sources that left the roster', () => {
    const withTyping = presenceReducer(
      initialState,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 1)] })])),
    );
    const without = presenceReducer(withTyping, presenceRosterReceived(roster([member('a')])));
    expect(without.liveTyping['ws-1']).toEqual({});
  });

  it('expires only the exact (source, pulse) pair and never revives it on a re-emitted roster', () => {
    const rosterWithTyping = roster([member('a', { typing: [typing('ts-1', 1)] })]);
    let state = presenceReducer(initialState, presenceRosterReceived(rosterWithTyping));

    const stale = presenceReducer(state, presenceTypingExpired('ws-1', 'ts-1', 0));
    expect(stale).toBe(state);

    state = presenceReducer(state, presenceTypingExpired('ws-1', 'ts-1', 1));
    expect(state.liveTyping['ws-1']['ts-1'].expired).toBe(true);

    const reEmitted = presenceReducer(state, presenceRosterReceived(rosterWithTyping));
    expect(reEmitted.liveTyping['ws-1']['ts-1'].expired).toBe(true);

    const advanced = presenceReducer(
      reEmitted,
      presenceRosterReceived(roster([member('a', { typing: [typing('ts-1', 2)] })])),
    );
    expect(advanced.liveTyping['ws-1']['ts-1'].expired).toBe(false);

    expect(presenceReducer(state, presenceTypingExpired('ws-1', 'ts-1', 1))).toBe(state);
    expect(presenceReducer(state, presenceTypingExpired('ws-9', 'ts-1', 1))).toBe(state);
  });

  it('tracks the own typing target without churning on repeated pulses', () => {
    const typingA = presenceReducer(initialState, presenceTypingPulse('agent-1'));
    expect(typingA.ownTyping).toEqual({ agentId: 'agent-1' });
    expect(presenceReducer(typingA, presenceTypingPulse('agent-1'))).toBe(typingA);
    expect(presenceReducer(typingA, presenceTypingPulse('agent-2')).ownTyping).toEqual({
      agentId: 'agent-2',
    });
    const stopped = presenceReducer(typingA, presenceTypingStopped());
    expect(stopped.ownTyping).toBeNull();
    expect(presenceReducer(stopped, presenceTypingStopped())).toBe(stopped);
  });

  it('records window visibility, identity and typing source', () => {
    let state = presenceReducer(initialState, presenceWindowVisibilityChanged(false));
    expect(state.windowVisible).toBe(false);
    expect(presenceReducer(state, presenceWindowVisibilityChanged(false))).toBe(state);
    state = presenceReducer(state, presenceOwnPrincipalReceived('me'));
    state = presenceReducer(state, presenceOwnTypingSourceReceived('ts-me'));
    expect(state.ownPrincipalId).toBe('me');
    expect(state.ownTypingSource).toBe('ts-me');
    expect(presenceReducer(state, presenceOwnTypingSourceReceived('ts-me'))).toBe(state);
  });

  it('replaces a workspace membership, keyed by principal, and keeps other workspaces', () => {
    let state = presenceReducer(
      initialState,
      presenceMembersReceived('ws-1', [accepted('owner-1', 'owner'), accepted('a')]),
    );
    state = presenceReducer(state, presenceMembersReceived('ws-2', [accepted('b')]));
    state = presenceReducer(state, presenceMembersReceived('ws-1', [accepted('owner-1', 'owner')]));
    expect(getItems(state.members['ws-1']).map((m) => m.principalId)).toEqual(['owner-1']);
    expect(getItems(state.members['ws-2']).map((m) => m.principalId)).toEqual(['b']);
    expect(getItem(state.members['ws-1'], 'a')).toBeUndefined();
    expect(getItem(state.members['ws-1'], 'owner-1')?.role).toBe('owner');
    expect(state.rosters).toEqual({});
  });

  it('resets everything but the window visibility on a backend switch', () => {
    let state = presenceReducer(initialState, presenceWindowVisibilityChanged(false));
    state = presenceReducer(state, presenceRosterReceived(roster([member('a')])));
    state = presenceReducer(state, presenceMembersReceived('ws-1', [accepted('a')]));
    state = presenceReducer(state, presenceOwnPrincipalReceived('me'));
    state = presenceReducer(state, presenceTypingPulse('agent-1'));
    const reset = presenceReducer(state, presenceReset());
    expect(reset).toEqual({ ...initialState, windowVisible: false });
  });
});

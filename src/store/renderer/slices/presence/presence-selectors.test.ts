import { describe, expect, it } from 'vitest';
import type { PresenceMember, PresenceTypingEntry } from '$shared/types/presence';
import type { StoreState } from '../../types';
import {
  presenceOwnPrincipalReceived,
  presenceOwnTypingSourceReceived,
  presenceReducer,
  presenceRosterReceived,
  presenceTypingExpired,
  presenceWindowVisibilityChanged,
  presenceTypingPulse,
  initialState,
} from './presence-slice';
import {
  selectAgentPresencePeople,
  selectAgentTypingPeople,
  selectOwnPresenceReport,
  selectWorkspacePresenceMembers,
  selectWorkspacePresencePeople,
} from './presence-selectors';
import type { PresenceState } from './presence-types';

const member = (principalId: string, overrides: Partial<PresenceMember> = {}): PresenceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  focus: [],
  typing: [],
  ...overrides,
});

const typing = (source: string, pulse: number, agentId = 'agent-1'): PresenceTypingEntry => ({
  source,
  agentId,
  since: '2026-09-14T12:00:00Z',
  pulse,
});

const reduce = (...actions: Parameters<typeof presenceReducer>[1][]): PresenceState =>
  actions.reduce((state, action) => presenceReducer(state, action), initialState);

const stateWith = (presence: PresenceState, extra: Record<string, unknown> = {}): StoreState =>
  ({
    presence,
    tabState: { currentTabId: null },
    panelLayout: { byWorkspaceId: {} },
    ...extra,
  }) as unknown as StoreState;

const ids = (people: { principalId: string }[]) => people.map((p) => p.principalId);

describe('presence selectors', () => {
  const roster = presenceRosterReceived({
    workspaceId: 'ws-1',
    members: [
      member('me', {
        focus: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-1', agentId: 'agent-1' }],
      }),
      member('viewer', {
        focus: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-1', agentId: 'agent-1' }],
      }),
      member('idle'),
      member('other-agent', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-2' }] }),
    ],
  });

  it('excludes the own principal from members, viewers and agent people', () => {
    const state = stateWith(reduce(roster, presenceOwnPrincipalReceived('me')));
    expect(ids(selectWorkspacePresenceMembers.select(state, 'ws-1'))).toEqual([
      'viewer',
      'idle',
      'other-agent',
    ]);
    expect(ids(selectWorkspacePresencePeople.select(state, 'ws-1'))).toEqual([
      'viewer',
      'other-agent',
    ]);
    expect(ids(selectAgentPresencePeople.select(state, 'ws-1', 'agent-1'))).toEqual(['viewer']);
    expect(selectAgentPresencePeople.select(state, 'ws-9', 'agent-1')).toEqual([]);
  });

  it('keeps every member while the own principal is unknown', () => {
    const state = stateWith(reduce(roster));
    expect(ids(selectWorkspacePresenceMembers.select(state, 'ws-1'))).toHaveLength(4);
  });

  it('lists typing people once per person, minus the own source and expired pulses', () => {
    const typingRoster = presenceRosterReceived({
      workspaceId: 'ws-1',
      members: [
        member('me', { typing: [typing('ts-me', 1)] }),
        member('two-clients', { typing: [typing('ts-a', 1), typing('ts-b', 4)] }),
        member('elsewhere', { typing: [typing('ts-c', 2, 'agent-2')] }),
        member('stale', { typing: [typing('ts-d', 7)] }),
      ],
    });
    const presence = reduce(
      typingRoster,
      presenceOwnTypingSourceReceived('ts-me'),
      presenceTypingExpired('ws-1', 'ts-d', 7),
    );
    const state = stateWith(presence);
    expect(ids(selectAgentTypingPeople.select(state, 'ws-1', 'agent-1'))).toEqual(['two-clients']);
    expect(ids(selectAgentTypingPeople.select(state, 'ws-1', 'agent-2'))).toEqual(['elsewhere']);
    expect(selectAgentTypingPeople.select(state, 'ws-2', 'agent-1')).toEqual([]);
  });

  it('reports the current tab, each panel focus and the typing target only while visible', () => {
    const layout = {
      byWorkspaceId: {
        'ws-1': {
          panels: {
            b: { activeTabId: 'n', tabs: [{ id: 'n', type: 'note', noteId: 'note-1' }] },
            a: { activeTabId: 't', tabs: [{ id: 't', type: 'agent', agentId: 'agent-1' }] },
            c: { activeTabId: null, tabs: [{ id: 'x', type: 'agent', agentId: 'agent-9' }] },
          },
        },
      },
    };
    const visible = stateWith(reduce(presenceTypingPulse('agent-1')), {
      tabState: { currentTabId: 'ws-1' },
      panelLayout: layout,
    });
    expect(selectOwnPresenceReport.select(visible)).toEqual({
      focus: [
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-1', agentId: 'agent-1' },
        { workspaceId: 'ws-1', noteId: 'note-1' },
      ],
      typing: { agentId: 'agent-1' },
    });

    const hidden = stateWith(
      reduce(presenceTypingPulse('agent-1'), presenceWindowVisibilityChanged(false)),
      { tabState: { currentTabId: 'ws-1' }, panelLayout: layout },
    );
    expect(selectOwnPresenceReport.select(hidden)).toEqual({ focus: [], typing: null });

    const noTab = stateWith(reduce(presenceTypingPulse('agent-1')), { panelLayout: layout });
    expect(selectOwnPresenceReport.select(noTab)).toEqual({ focus: [], typing: null });
  });
});

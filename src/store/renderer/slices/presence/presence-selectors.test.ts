import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import type { Workspace, WorkspaceRole } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { PresenceMember, PresenceTypingEntry } from '$shared/types/presence';
import type { StoreState } from '../../types';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';
import {
  presenceMembersReceived,
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
  hasOtherPresence,
  selectAgentPresencePeople,
  selectAgentTypingPeople,
  selectOwnPresenceReport,
  selectPresenceMembershipKeys,
  selectWorkspacePresenceFocusTargets,
  selectWorkspacePresencePeople,
} from './presence-selectors';
import type { PresencePerson, PresenceState } from './presence-types';

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

const accepted = (principalId: string, role: WorkspaceRole = 'collaborator'): WorkspaceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  role,
  addedAt: '2026-09-14T12:00:00Z',
});

const shared = (
  id: string,
  membership: Pick<Workspace, 'ownerPrincipalId' | 'myRole' | 'memberCount'>,
): Workspace => ({ id: WorkspaceId(id), title: id, ...membership }) as Workspace;

const workspacesWith = (...workspaces: Workspace[]) => ({
  workspaces: createCollection('id', workspaces),
});

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

  const membership = presenceMembersReceived('ws-1', [
    accepted('me', 'owner'),
    accepted('viewer'),
    accepted('idle'),
    accepted('other-agent'),
    accepted('away'),
  ]);

  describe('workspace people (sidebar presence row)', () => {
    it('lists every other accepted member of a shared workspace, offline included but never self, in membership order', () => {
      const state = stateWith(reduce(roster, membership, presenceOwnPrincipalReceived('me')), {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 5 })),
      });
      const people = selectWorkspacePresencePeople.select(state, 'ws-1');
      expect(ids(people)).toEqual(['viewer', 'idle', 'other-agent', 'away']);
      expect(people.map((p) => [p.owner, p.online, p.viewing, p.self])).toEqual([
        [false, true, true, false],
        [false, true, false, false],
        [false, true, true, false],
        [false, false, false, false],
      ]);
    });

    it('orders the owner first, then online members, then offline ones, keeping membership order within each group', () => {
      const shuffled = presenceMembersReceived('ws-1', [
        accepted('away'),
        accepted('idle'),
        accepted('gone'),
        accepted('me', 'owner'),
        accepted('viewer'),
        accepted('other-agent'),
      ]);
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 6 }));
      const ownerOnline = stateWith(
        reduce(roster, shuffled, presenceOwnPrincipalReceived('viewer')),
        {
          workspace,
        },
      );
      expect(ids(selectWorkspacePresencePeople.select(ownerOnline, 'ws-1'))).toEqual([
        'me',
        'idle',
        'other-agent',
        'away',
        'gone',
      ]);

      const ownerAway = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('viewer'), member('idle'), member('other-agent')],
      });
      const ownerOffline = stateWith(
        reduce(ownerAway, shuffled, presenceOwnPrincipalReceived('viewer')),
        { workspace },
      );
      const people = selectWorkspacePresencePeople.select(ownerOffline, 'ws-1');
      expect(ids(people)).toEqual(['me', 'idle', 'other-agent', 'away', 'gone']);
      expect(people.map((p) => [p.owner, p.online])).toEqual([
        [true, false],
        [false, true],
        [false, true],
        [false, false],
        [false, false],
      ]);
    });

    it("carries each membership row's forge identity onto the person, none for a row without one", () => {
      const gitlab = {
        provider: 'gitlab',
        host: 'gitlab.example.com',
        externalUserId: '7',
      } as const;
      const github = { provider: 'github', host: 'github.com', externalUserId: '42' } as const;
      const state = stateWith(
        reduce(
          roster,
          presenceMembersReceived('ws-1', [
            accepted('me', 'owner'),
            { ...accepted('viewer'), identity: gitlab },
            { ...accepted('idle'), identity: github },
            accepted('away'),
          ]),
          presenceOwnPrincipalReceived('me'),
        ),
        { workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 4 })) },
      );
      const people = selectWorkspacePresencePeople.select(state, 'ws-1');
      expect(people.map((p) => [p.principalId, p.identity])).toEqual([
        ['viewer', gitlab],
        ['idle', github],
        ['away', undefined],
      ]);
      expect('identity' in people[2]).toBe(false);
    });

    it('resolves where each online member looks: their agent chat first, else their note, nothing for the bare tab', () => {
      const focused = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('viewer', {
            focus: [
              { workspaceId: 'ws-1' },
              { workspaceId: 'ws-1', noteId: 'note-1' },
              { workspaceId: 'ws-1', agentId: 'agent-1' },
            ],
          }),
          member('reader', {
            focus: [
              { workspaceId: 'ws-2', agentId: 'agent-9' },
              { workspaceId: 'ws-1', noteId: 'note-2' },
            ],
          }),
          member('idle', { focus: [{ workspaceId: 'ws-1' }] }),
        ],
      });
      const state = stateWith(reduce(focused, presenceOwnPrincipalReceived('me')));
      expect(selectWorkspacePresenceFocusTargets.select(state, 'ws-1')).toEqual({
        viewer: { kind: 'agent', agentId: 'agent-1' },
        reader: { kind: 'note', noteId: 'note-2' },
      });
      expect(selectWorkspacePresenceFocusTargets.select(state, 'ws-9')).toEqual({});
    });

    it('shows nothing for an unshared workspace even when its roster and membership are known', () => {
      const presence = reduce(roster, membership, presenceOwnPrincipalReceived('me'));
      const solo = stateWith(presence, {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 1 })),
      });
      expect(selectWorkspacePresencePeople.select(solo, 'ws-1')).toEqual([]);
      const legacy = stateWith(presence, { workspace: workspacesWith(shared('ws-1', {})) });
      expect(selectWorkspacePresencePeople.select(legacy, 'ws-1')).toEqual([]);
      const unlisted = stateWith(presence, { workspace: workspacesWith() });
      expect(selectWorkspacePresencePeople.select(unlisted, 'ws-1')).toEqual([]);
    });

    it('shows nothing until the membership of a shared workspace was read', () => {
      const state = stateWith(reduce(roster, presenceOwnPrincipalReceived('me')), {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 5 })),
      });
      expect(selectWorkspacePresencePeople.select(state, 'ws-1')).toEqual([]);
    });

    it('keeps listing every other member of a shared workspace, all offline, while only this window is online, with no roster at all, and after the last other person leaves', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 3 }));
      const shared3 = presenceMembersReceived('ws-1', [
        accepted('me', 'owner'),
        accepted('viewer'),
        accepted('away'),
      ]);
      const allOffline = [
        [false, false],
        [false, false],
      ];
      const aloneRoster = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('me', { focus: [{ workspaceId: 'ws-1' }] })],
      });
      const alone = stateWith(reduce(aloneRoster, shared3, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      const alonePeople = selectWorkspacePresencePeople.select(alone, 'ws-1');
      expect(ids(alonePeople)).toEqual(['viewer', 'away']);
      expect(alonePeople.map((p) => [p.online, p.self])).toEqual(allOffline);

      const emptyRoster = presenceRosterReceived({ workspaceId: 'ws-1', members: [] });
      const nobody = stateWith(reduce(emptyRoster, shared3, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople.select(nobody, 'ws-1').map((p) => [p.online, p.self]),
      ).toEqual(allOffline);

      const noRoster = stateWith(reduce(shared3, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople.select(noRoster, 'ws-1').map((p) => [p.online, p.self]),
      ).toEqual(allOffline);

      const joinedRoster = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('me', { focus: [{ workspaceId: 'ws-1' }] }), member('viewer')],
      });
      const joined = stateWith(reduce(joinedRoster, shared3, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      const people = selectWorkspacePresencePeople.select(joined, 'ws-1');
      expect(ids(people)).toEqual(['viewer', 'away']);
      expect(people.map((p) => [p.online, p.self])).toEqual([
        [true, false],
        [false, false],
      ]);

      const left = stateWith(
        reduce(joinedRoster, shared3, presenceOwnPrincipalReceived('me'), aloneRoster),
        { workspace },
      );
      const leftPeople = selectWorkspacePresencePeople.select(left, 'ws-1');
      expect(ids(leftPeople)).toEqual(['viewer', 'away']);
      expect(leftPeople.map((p) => [p.online, p.self])).toEqual(allOffline);
    });

    it('marks an offline owner as the owner for a guest whose window is the only one online', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 }));
      const two = presenceMembersReceived('ws-1', [accepted('me', 'owner'), accepted('guest:abc')]);
      const guestOnly = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('guest:abc', { focus: [{ workspaceId: 'ws-1' }] })],
      });
      const state = stateWith(reduce(guestOnly, two, presenceOwnPrincipalReceived('guest:abc')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople
          .select(state, 'ws-1')
          .map((p) => [p.principalId, p.owner, p.online, p.self]),
      ).toEqual([['me', true, false, false]]);
    });

    it('shows nothing while the own principal is unknown, even with another accepted member listed', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 }));
      const two = presenceMembersReceived('ws-1', [accepted('me', 'owner'), accepted('away')]);
      const meOnly = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('me', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] })],
      });
      const unknown = stateWith(reduce(meOnly, two), { workspace });
      expect(selectWorkspacePresencePeople.select(unknown, 'ws-1')).toEqual([]);
      const knownLater = stateWith(reduce(meOnly, two, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople
          .select(knownLater, 'ws-1')
          .map((p) => [p.principalId, p.online]),
      ).toEqual([['away', false]]);
      const everyoneOnline = stateWith(reduce(roster, two), { workspace });
      expect(selectWorkspacePresencePeople.select(everyoneOnline, 'ws-1')).toEqual([]);
      const identified = stateWith(reduce(roster, two, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople
          .select(identified, 'ws-1')
          .map((p) => [p.principalId, p.online]),
      ).toEqual([['away', false]]);
      const viewerAccepted = presenceMembersReceived('ws-1', [
        accepted('me', 'owner'),
        accepted('viewer'),
      ]);
      const viewerIdentified = stateWith(
        reduce(roster, viewerAccepted, presenceOwnPrincipalReceived('me')),
        { workspace },
      );
      expect(ids(selectWorkspacePresencePeople.select(viewerIdentified, 'ws-1'))).toEqual([
        'viewer',
      ]);
    });

    it('tells the members apart by principal id, not by name: a same-named other person counts, a same-named self does not', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'p-1', memberCount: 2 }));
      const twins = presenceMembersReceived('ws-1', [
        { ...accepted('p-1', 'owner'), login: 'alice', displayName: 'Alice' },
        { ...accepted('p-2'), login: 'alice', displayName: 'Alice' },
      ]);
      const bothOnline = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('p-1', { login: 'alice', displayName: 'Alice', focus: [{ workspaceId: 'ws-1' }] }),
          member('p-2', { login: 'alice', displayName: 'Alice', focus: [{ workspaceId: 'ws-1' }] }),
        ],
      });
      const shown = stateWith(reduce(bothOnline, twins, presenceOwnPrincipalReceived('p-1')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople.select(shown, 'ws-1').map((p) => [p.principalId, p.self]),
      ).toEqual([['p-2', false]]);
      const selfOnly = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('p-1', { login: 'alice', displayName: 'Alice', focus: [{ workspaceId: 'ws-1' }] }),
        ],
      });
      const twinOffline = stateWith(reduce(selfOnly, twins, presenceOwnPrincipalReceived('p-1')), {
        workspace,
      });
      expect(
        selectWorkspacePresencePeople
          .select(twinOffline, 'ws-1')
          .map((p) => [p.principalId, p.online, p.self]),
      ).toEqual([['p-2', false, false]]);
    });

    it('shows the owner to a guest looking at the shared workspace, without the guest themself', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 }));
      const membershipWithGuest = presenceMembersReceived('ws-1', [
        accepted('me', 'owner'),
        accepted('guest:abc'),
      ]);
      const bothLooking = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('me', { focus: [{ workspaceId: 'ws-1' }] }),
          member('guest:abc', { focus: [{ workspaceId: 'ws-1' }] }),
        ],
      });
      const state = stateWith(
        reduce(bothLooking, membershipWithGuest, presenceOwnPrincipalReceived('guest:abc')),
        { workspace },
      );
      expect(
        selectWorkspacePresencePeople
          .select(state, 'ws-1')
          .map((p) => [p.principalId, p.owner, p.self]),
      ).toEqual([['me', true, false]]);
    });
  });

  describe('hasOtherPresence (the indicator rule)', () => {
    const person = (facts: Pick<PresencePerson, 'online' | 'self'>): PresencePerson => ({
      principalId: `${facts.self ? 'me' : 'other'}-${facts.online ? 'on' : 'off'}`,
      login: null,
      displayName: null,
      avatarUrl: null,
      owner: false,
      viewing: false,
      ...facts,
    });

    it('is true only when someone other than self is online', () => {
      expect(hasOtherPresence([])).toBe(false);
      expect(hasOtherPresence([person({ online: true, self: true })])).toBe(false);
      expect(
        hasOtherPresence([
          person({ online: true, self: true }),
          person({ online: false, self: false }),
        ]),
      ).toBe(false);
      expect(
        hasOtherPresence([
          person({ online: true, self: true }),
          person({ online: true, self: false }),
        ]),
      ).toBe(true);
      expect(hasOtherPresence([person({ online: true, self: false })])).toBe(true);
    });
  });

  describe('agent people (chat circles)', () => {
    it('leaves the own principal out and marks the owner by ownerPrincipalId', () => {
      const state = stateWith(reduce(roster, presenceOwnPrincipalReceived('me')), {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'viewer', memberCount: 2 })),
      });
      const people = selectAgentPresencePeople.select(state, 'ws-1', 'agent-1');
      expect(ids(people)).toEqual(['viewer']);
      expect(people.map((p) => [p.owner, p.online, p.viewing, p.self])).toEqual([
        [true, true, true, false],
      ]);
      expect(ids(selectAgentPresencePeople.select(state, 'ws-1', 'agent-2'))).toEqual([
        'other-agent',
      ]);
      expect(selectAgentPresencePeople.select(state, 'ws-9', 'agent-1')).toEqual([]);
    });

    it('shows no circle at all in a chat only this window looks at', () => {
      const soloRoster = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('me', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] }),
          member('elsewhere', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-2' }] }),
        ],
      });
      const presence = reduce(soloRoster, presenceOwnPrincipalReceived('me'));
      const unshared = stateWith(presence, {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 1 })),
      });
      expect(selectAgentPresencePeople.select(unshared, 'ws-1', 'agent-1')).toEqual([]);
      const sharedButAlone = stateWith(presence, {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 })),
      });
      expect(selectAgentPresencePeople.select(sharedButAlone, 'ws-1', 'agent-1')).toEqual([]);
    });

    it('shows no circle while the own principal is unknown, however many roster rows look at the chat', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 }));
      const meOnly = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [member('me', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] })],
      });
      expect(
        selectAgentPresencePeople.select(
          stateWith(reduce(meOnly), { workspace }),
          'ws-1',
          'agent-1',
        ),
      ).toEqual([]);
      const unknown = stateWith(reduce(roster), { workspace });
      expect(selectAgentPresencePeople.select(unknown, 'ws-1', 'agent-1')).toEqual([]);
      expect(selectAgentPresencePeople.select(unknown, 'ws-1', 'agent-2')).toEqual([]);
      const identified = stateWith(reduce(roster, presenceOwnPrincipalReceived('me')), {
        workspace,
      });
      expect(ids(selectAgentPresencePeople.select(identified, 'ws-1', 'agent-1'))).toEqual([
        'viewer',
      ]);
    });

    it('hides the circles the moment the workspace stops being shared, before any roster replacement', () => {
      const bothLooking = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('me', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] }),
          member('other', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] }),
        ],
      });
      const presence = reduce(bothLooking, presenceOwnPrincipalReceived('me'));
      const sharedState = stateWith(presence, {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 })),
      });
      expect(ids(selectAgentPresencePeople.select(sharedState, 'ws-1', 'agent-1'))).toEqual([
        'other',
      ]);
      const unshared = stateWith(presence, {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 1 })),
      });
      expect(selectAgentPresencePeople.select(unshared, 'ws-1', 'agent-1')).toEqual([]);
      expect(selectWorkspacePresencePeople.select(unshared, 'ws-1')).toEqual([]);
      const legacy = stateWith(presence, { workspace: workspacesWith(shared('ws-1', {})) });
      expect(selectAgentPresencePeople.select(legacy, 'ws-1', 'agent-1')).toEqual([]);
      const unlisted = stateWith(presence, { workspace: workspacesWith() });
      expect(selectAgentPresencePeople.select(unlisted, 'ws-1', 'agent-1')).toEqual([]);
    });

    it('shows the owner to a guest in the chat, the owner blue and the guest themself left out', () => {
      const bothLooking = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          member('me', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] }),
          member('guest:abc', { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] }),
        ],
      });
      const state = stateWith(reduce(bothLooking, presenceOwnPrincipalReceived('guest:abc')), {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'me', memberCount: 2 })),
      });
      expect(
        selectAgentPresencePeople
          .select(state, 'ws-1', 'agent-1')
          .map((p) => [p.principalId, p.owner, p.self]),
      ).toEqual([['me', true, false]]);
    });

    it('leads with the owner even when the roster lists them after another viewer, keeping the others in roster order', () => {
      const lookingAt = (principalId: string) =>
        member(principalId, { focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }] });
      const ownerLast = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          lookingAt('me'),
          lookingAt('second'),
          lookingAt('first'),
          lookingAt('boss'),
          lookingAt('third'),
        ],
      });
      const state = stateWith(reduce(ownerLast, presenceOwnPrincipalReceived('me')), {
        workspace: workspacesWith(shared('ws-1', { ownerPrincipalId: 'boss', memberCount: 5 })),
      });
      const people = selectAgentPresencePeople.select(state, 'ws-1', 'agent-1');
      expect(ids(people)).toEqual(['boss', 'second', 'first', 'third']);
      expect(people.map((p) => p.owner)).toEqual([true, false, false, false]);
    });

    it('tells a same-named other person apart from self by principal id', () => {
      const workspace = workspacesWith(shared('ws-1', { ownerPrincipalId: 'p-1', memberCount: 2 }));
      const alice = (principalId: string) =>
        member(principalId, {
          login: 'alice',
          displayName: 'Alice',
          focus: [{ workspaceId: 'ws-1', agentId: 'agent-1' }],
        });
      const twins = presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [alice('p-1'), alice('p-2')],
      });
      const shown = stateWith(reduce(twins, presenceOwnPrincipalReceived('p-1')), { workspace });
      expect(
        selectAgentPresencePeople
          .select(shown, 'ws-1', 'agent-1')
          .map((p) => [p.principalId, p.self]),
      ).toEqual([['p-2', false]]);
      const selfOnly = presenceRosterReceived({ workspaceId: 'ws-1', members: [alice('p-1')] });
      const hidden = stateWith(reduce(selfOnly, presenceOwnPrincipalReceived('p-1')), {
        workspace,
      });
      expect(selectAgentPresencePeople.select(hidden, 'ws-1', 'agent-1')).toEqual([]);
    });
  });

  it('keys the membership reads on the open shared tabs and their member counts', () => {
    const state = stateWith(reduce(), {
      workspace: workspacesWith(
        shared('ws-1', { memberCount: 3 }),
        shared('ws-2', { memberCount: 1 }),
        shared('ws-3', { memberCount: 2 }),
        shared('ws-4', { memberCount: 4 }),
      ),
      tabState: {
        currentTabId: 'ws-1',
        openTabs: { 'ws-4': true, 'ws-1': true, 'ws-2': true, 'ws-3': false },
      },
    });
    expect(selectPresenceMembershipKeys.select(state)).toEqual(['ws-1:3', 'ws-4:4']);
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

/**
 * Presence Selectors (multiplayer w5)
 *
 * The people selectors project the daemon's two sources into the brief's
 * circles: the accepted membership (`workspace.members.list`, owners first)
 * says who belongs and which of them owns the workspace; the roster
 * (`presence:changed`) says who is online and where they look. Both people
 * selectors show nothing while nobody but this window's own principal is
 * online in their scope (`hasOtherPresence`), so an owner alone sees no
 * presence indicator at all. The typing selector hands back the roster's own
 * member objects, so its result stays shallow-equal between rosters.
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { PresenceFocusItem, PresenceMember } from '$shared/types/presence';
import { store } from '../../store';
import type { PresenceIdentity, PresencePerson, PresenceState } from './presence-types';

const NO_MEMBERS: PresenceMember[] = [];
const NO_PEOPLE: PresencePerson[] = [];

const rosterMembers = (presence: PresenceState, workspaceId: string): PresenceMember[] => {
  const roster = presence.rosters[workspaceId];
  return roster ? getItems(roster) : NO_MEMBERS;
};

const toPerson = (
  identity: PresenceIdentity,
  facts: Pick<PresencePerson, 'owner' | 'online' | 'viewing' | 'self'>,
): PresencePerson => ({
  principalId: identity.principalId,
  login: identity.login,
  displayName: identity.displayName,
  avatarUrl: identity.avatarUrl,
  ...facts,
});

/**
 * Whether someone other than this window's own principal is online among
 * `people` — the rule every presence indicator renders by: an indicator is
 * shown only when at least one other person is currently there, and the self
 * avatar then rides along inside it. Offline members never count.
 */
export const hasOtherPresence = (people: readonly PresencePerson[]): boolean =>
  people.some((person) => person.online && !person.self);

/** Every roster this window received, by workspace id (self included). */
export const selectPresenceRosters = store.createSelector((state) => state.presence.rosters);

/** Every accepted membership this window read, by workspace id. */
export const selectPresenceMembers = store.createSelector((state) => state.presence.members);

/**
 * The circles of a workspace tab and the rows of its hover card: every
 * accepted member of a SHARED workspace (`memberCount > 1`; the owner and
 * this window's own principal included) in `workspace.members.list` order,
 * online when the roster lists them, viewing when that roster row has a
 * focus item. An unshared workspace, one whose membership was not read yet,
 * or one where nobody else is online right now shows nothing.
 */
export const selectWorkspacePresencePeople = store.createSelector<
  [workspaceId: string],
  PresencePerson[]
>((state, workspaceId) => {
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  if (!workspace || (workspace.memberCount ?? 1) <= 1) return NO_PEOPLE;
  const members = state.presence.members[workspaceId];
  if (!members) return NO_PEOPLE;
  const roster = state.presence.rosters[workspaceId];
  const people = getItems(members).map((member) => {
    const online = roster ? getItem(roster, member.principalId) : undefined;
    return toPerson(member, {
      owner: member.role === 'owner',
      online: online !== undefined,
      viewing: (online?.focus.length ?? 0) > 0,
      self: member.principalId === state.presence.ownPrincipalId,
    });
  });
  return hasOtherPresence(people) ? people : NO_PEOPLE;
});

/**
 * The circles of a chat's title bar: everyone whose focus includes this
 * agent's chat right now — this window's own principal first — with the
 * owner (`ownerPrincipalId`) blue. Nobody offline appears here, and a solo
 * user sees no circle at all.
 */
export const selectAgentPresencePeople = store.createSelector<
  [workspaceId: string, agentId: string],
  PresencePerson[]
>((state, workspaceId, agentId) => {
  const ownerPrincipalId = getItem(
    state.workspace.workspaces,
    WorkspaceId(workspaceId),
  )?.ownerPrincipalId;
  const people = rosterMembers(state.presence, workspaceId)
    .filter((member) =>
      member.focus.some((item) => item.workspaceId === workspaceId && item.agentId === agentId),
    )
    .map((member) =>
      toPerson(member, {
        owner: member.principalId === ownerPrincipalId,
        online: true,
        viewing: true,
        self: member.principalId === state.presence.ownPrincipalId,
      }),
    )
    .sort((a, b) => Number(b.self) - Number(a.self));
  return hasOtherPresence(people) ? people : NO_PEOPLE;
});

/**
 * The other people with a connection currently typing to this agent — one
 * row per person even when two of their clients type — minus this window's
 * own connection and every `(source, pulse)` pair whose 3 s expiry ran out.
 */
export const selectAgentTypingPeople = store.createSelector<
  [workspaceId: string, agentId: string],
  PresenceIdentity[]
>((state, workspaceId, agentId) => {
  const live = state.presence.liveTyping[workspaceId];
  const roster = state.presence.rosters[workspaceId];
  if (!live || !roster) return NO_MEMBERS;
  const typingPrincipals = new Set<string>();
  for (const source of Object.keys(live)) {
    const entry = live[source];
    if (entry.expired || entry.agentId !== agentId || source === state.presence.ownTypingSource)
      continue;
    if (getItem(roster, entry.principalId)) typingPrincipals.add(entry.principalId);
  }
  if (typingPrincipals.size === 0) return NO_MEMBERS;
  return getItems(roster).filter((member) => typingPrincipals.has(member.principalId));
});

/**
 * This window's own `presence.update` contribution: the current workspace
 * tab plus the agent / note each of its panels shows, and the typing target.
 * A hidden window contributes nothing at all.
 */
export const selectOwnPresenceReport = store.createSelector(
  (state): { focus: PresenceFocusItem[]; typing: { agentId: string } | null } => {
    if (!state.presence.windowVisible) return { focus: [], typing: null };
    const workspaceId = state.tabState.currentTabId;
    if (!workspaceId) return { focus: [], typing: null };
    const focus: PresenceFocusItem[] = [{ workspaceId }];
    const panels = state.panelLayout.byWorkspaceId[workspaceId]?.panels ?? {};
    for (const panelId of Object.keys(panels).sort()) {
      const panel = panels[panelId];
      const tab = panel.activeTabId
        ? panel.tabs.find((candidate) => candidate.id === panel.activeTabId)
        : undefined;
      if (!tab) continue;
      if (tab.type === 'agent' && tab.agentId) focus.push({ workspaceId, agentId: tab.agentId });
      else if (tab.type === 'note' && tab.noteId) focus.push({ workspaceId, noteId: tab.noteId });
    }
    return { focus, typing: state.presence.ownTyping };
  },
);

/** `selectOwnPresenceReport` serialized, so a selector channel fires only on real change. */
export const selectOwnPresenceReportKey = store.createSelector((state) =>
  JSON.stringify(selectOwnPresenceReport.select(state)),
);

/** The workspaces whose typing bookkeeping the saga must run timers for. */
export const selectPresenceLiveTyping = store.createSelector((state) => state.presence.liveTyping);

export const selectPresenceOwnPrincipalId = store.createSelector(
  (state) => state.presence.ownPrincipalId,
);

/**
 * `${workspaceId}:${memberCount}` for every open workspace tab that is
 * shared — the saga's signal to (re)read `workspace.members.list`: a tab
 * opening, or the daemon's `workspace:updated` moving a membership count,
 * changes an entry. Sorted so the array is shallow-stable otherwise.
 */
export const selectPresenceMembershipKeys = store.createSelector((state): string[] => {
  const keys: string[] = [];
  for (const workspaceId of Object.keys(state.tabState.openTabs)) {
    if (state.tabState.openTabs[workspaceId] !== true) continue;
    const memberCount =
      getItem(state.workspace.workspaces, WorkspaceId(workspaceId))?.memberCount ?? 1;
    if (memberCount > 1) keys.push(`${workspaceId}:${memberCount}`);
  }
  return keys.sort();
});

/**
 * Presence Selectors (multiplayer w5)
 *
 * The people selectors project the daemon's two sources into the brief's
 * circles: the accepted membership (`workspace.members.list`, owners first)
 * says who belongs and which of them owns the workspace; the roster
 * (`presence:changed`) says who is online and where they look. Both people
 * selectors show nothing for an unshared workspace and while this window's
 * own principal is still unknown (nobody can then be told apart from self, so
 * the indicators fail closed); the chat circles additionally need someone
 * else online in their scope (`hasOtherPresence`), while the sidebar row
 * lists every other member of a shared workspace even when they are all
 * offline. The viewer's own principal is never among the people returned —
 * every surface shows everybody else. The typing selector hands back the
 * roster's own member objects, so its result stays shallow-equal between
 * rosters.
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { PresenceFocusItem, PresenceMember } from '$shared/types/presence';
import type { WorkspaceMember } from '../guest-sessions/guest-sessions-types';
import { store } from '../../store';
import type { StoreState } from '../../types';
import type {
  PresenceFocusTarget,
  PresenceIdentity,
  PresencePerson,
  PresenceState,
} from './presence-types';

const NO_MEMBERS: PresenceMember[] = [];
const NO_PEOPLE: PresencePerson[] = [];
type MentionMember = WorkspaceMember & { login: string };
const NO_MENTION_MEMBERS: MentionMember[] = [];
const NO_TARGETS: Record<string, PresenceFocusTarget> = {};

const rosterMembers = (presence: PresenceState, workspaceId: string): PresenceMember[] => {
  const roster = presence.rosters[workspaceId];
  return roster ? getItems(roster) : NO_MEMBERS;
};

/** The workspace row when it is shared (`memberCount > 1`); `undefined` gates both people selectors off. */
const sharedWorkspace = (state: StoreState, workspaceId: string): Workspace | undefined => {
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  return workspace && (workspace.memberCount ?? 1) > 1 ? workspace : undefined;
};

/** Accepted members with handles, independent of online presence; fail closed until self is known. */
export const selectWorkspaceMentionMembers = store.createSelector<
  [workspaceId: string],
  MentionMember[]
>((state, workspaceId) => {
  const ownPrincipalId = state.presence.ownPrincipalId;
  if (ownPrincipalId === null || !sharedWorkspace(state, workspaceId)) return NO_MENTION_MEMBERS;
  const members = state.presence.members[workspaceId];
  if (!members) return NO_MENTION_MEMBERS;
  return getItems(members).filter(
    (member): member is MentionMember =>
      member.principalId !== ownPrincipalId && Boolean(member.login?.trim()),
  );
});

const toPerson = (
  identity: PresenceIdentity,
  facts: Pick<PresencePerson, 'owner' | 'online' | 'viewing' | 'self'>,
): PresencePerson => ({
  principalId: identity.principalId,
  login: identity.login,
  displayName: identity.displayName,
  avatarUrl: identity.avatarUrl,
  ...(identity.identity ? { identity: identity.identity } : {}),
  ...facts,
});

/**
 * Whether someone other than this window's own principal is online among
 * `people` — the rule the chat circles render by: a circle is shown only
 * when at least one other person is currently there. Offline members never
 * count.
 */
export const hasOtherPresence = (people: readonly PresencePerson[]): boolean =>
  people.some((person) => person.online && !person.self);

/**
 * Row order shared by the sidebar presence stack and the chat title-bar stack:
 * owner, then online members, then offline ones (the chat stack only ever has
 * online people, so there it reduces to owner first).
 */
const presenceRowRank = (person: PresencePerson): number =>
  person.owner ? 0 : person.online ? 1 : 2;

/**
 * The circles of the workspace sidebar's presence row: every OTHER accepted
 * member of a SHARED workspace (`memberCount > 1`; the owner included, this
 * window's own principal left out), online when the roster lists them,
 * viewing when that roster row has a focus item. The owner leads (online or
 * not), then the other online members, then the offline ones, each group
 * keeping its `workspace.members.list` order. Offline members stay listed
 * (the stack draws them greyscale), so the row shows the whole membership
 * even while this window is the only one online. An unshared workspace, one
 * whose membership was not read yet, or an unknown own principal shows
 * nothing.
 */
export const selectWorkspacePresencePeople = store.createSelector<
  [workspaceId: string],
  PresencePerson[]
>((state, workspaceId) => {
  const ownPrincipalId = state.presence.ownPrincipalId;
  if (ownPrincipalId === null || !sharedWorkspace(state, workspaceId)) return NO_PEOPLE;
  const members = state.presence.members[workspaceId];
  if (!members) return NO_PEOPLE;
  const roster = state.presence.rosters[workspaceId];
  const people = getItems(members)
    .filter((member) => member.principalId !== ownPrincipalId)
    .map((member) => {
      const online = roster ? getItem(roster, member.principalId) : undefined;
      return toPerson(member, {
        owner: member.role === 'owner',
        online: online !== undefined,
        viewing: (online?.focus.length ?? 0) > 0,
        self: false,
      });
    })
    .sort((a, b) => presenceRowRank(a) - presenceRowRank(b));
  return people.length > 0 ? people : NO_PEOPLE;
});

/**
 * Where each online member of a workspace looks right now, by principal id:
 * the agent chat their roster focus names (preferred), else the note. People
 * whose focus is only the bare workspace tab have no entry.
 */
export const selectWorkspacePresenceFocusTargets = store.createSelector<
  [workspaceId: string],
  Record<string, PresenceFocusTarget>
>((state, workspaceId) => {
  let targets: Record<string, PresenceFocusTarget> | null = null;
  for (const member of rosterMembers(state.presence, workspaceId)) {
    const items = member.focus.filter((item) => item.workspaceId === workspaceId);
    const agentId = items.find((item) => item.agentId)?.agentId;
    const noteId = items.find((item) => item.noteId)?.noteId;
    const target: PresenceFocusTarget | null = agentId
      ? { kind: 'agent', agentId }
      : noteId
        ? { kind: 'note', noteId }
        : null;
    if (!target) continue;
    (targets ??= {})[member.principalId] = target;
  }
  return targets ?? NO_TARGETS;
});

/**
 * The circles of a chat's title bar: everyone else whose focus includes this
 * agent's chat right now, with the owner (`ownerPrincipalId`) blue and leading
 * the stack (same rank as the sidebar row), the others in roster order. Nobody
 * offline appears here, and an unshared workspace, an unknown own principal,
 * or a solo user shows no circle at all (so the last unshare hides the
 * circles at once, before any roster replacement arrives).
 */
export const selectAgentPresencePeople = store.createSelector<
  [workspaceId: string, agentId: string],
  PresencePerson[]
>((state, workspaceId, agentId) => {
  const ownPrincipalId = state.presence.ownPrincipalId;
  const workspace = sharedWorkspace(state, workspaceId);
  if (ownPrincipalId === null || !workspace) return NO_PEOPLE;
  const people = rosterMembers(state.presence, workspaceId)
    .filter(
      (member) =>
        member.principalId !== ownPrincipalId &&
        member.focus.some((item) => item.workspaceId === workspaceId && item.agentId === agentId),
    )
    .map((member) =>
      toPerson(member, {
        owner: member.principalId === workspace.ownerPrincipalId,
        online: true,
        viewing: true,
        self: false,
      }),
    )
    .sort((a, b) => presenceRowRank(a) - presenceRowRank(b));
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

/**
 * The viewer's own principal id, or `null` until the daemon reports it.
 * @public consumed by `ChatPanel.svelte` on `fix/multiplayer-message-author-avatars`
 * (#2546); keep exported even while unused on this branch.
 */
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

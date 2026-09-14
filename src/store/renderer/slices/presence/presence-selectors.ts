/**
 * Presence Selectors (multiplayer w5)
 *
 * People selectors hand back the roster's own member objects (a
 * `PresenceMember` is a `PresencePerson`), so their results stay shallow-equal
 * between rosters and subscribers are not re-notified on unrelated updates.
 */

import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { PresenceFocusItem, PresenceMember } from '$shared/types/presence';
import type { PresencePerson, PresenceState } from './presence-types';

const NO_MEMBERS: PresenceMember[] = [];

const rosterMembers = (presence: PresenceState, workspaceId: string): PresenceMember[] => {
  const roster = presence.rosters[workspaceId];
  return roster ? getItems(roster) : NO_MEMBERS;
};

/** Every roster this window received, by workspace id (self included). */
export const selectPresenceRosters = store.createSelector((state) => state.presence.rosters);

/** Online members other than this window's principal (`focus.length > 0` = looking at the workspace). */
export const selectWorkspacePresenceMembers = store.createSelector<
  [workspaceId: string],
  PresenceMember[]
>((state, workspaceId) =>
  rosterMembers(state.presence, workspaceId).filter(
    (member) => member.principalId !== state.presence.ownPrincipalId,
  ),
);

/** The other people currently looking at the workspace (tab dots). */
export const selectWorkspacePresencePeople = store.createSelector<
  [workspaceId: string],
  PresencePerson[]
>((state, workspaceId) =>
  selectWorkspacePresenceMembers
    .select(state, workspaceId)
    .filter((member) => member.focus.length > 0),
);

/** The other people whose focus includes this agent's chat (chat presence circles). */
export const selectAgentPresencePeople = store.createSelector<
  [workspaceId: string, agentId: string],
  PresencePerson[]
>((state, workspaceId, agentId) =>
  rosterMembers(state.presence, workspaceId).filter(
    (member) =>
      member.principalId !== state.presence.ownPrincipalId &&
      member.focus.some((item) => item.workspaceId === workspaceId && item.agentId === agentId),
  ),
);

/**
 * The other people with a connection currently typing to this agent — one
 * row per person even when two of their clients type — minus this window's
 * own connection and every `(source, pulse)` pair whose 3 s expiry ran out.
 */
export const selectAgentTypingPeople = store.createSelector<
  [workspaceId: string, agentId: string],
  PresencePerson[]
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

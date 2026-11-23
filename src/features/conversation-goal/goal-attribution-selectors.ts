import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import type { Workspace } from '$shared/types';
import { isPresenceContextCurrent } from '$store/renderer/slices/presence/presence-selectors';
import {
  resolveGoalAttribution,
  sameGoalAttribution,
  type GoalAttribution,
} from './utils/goal-attribution';

// Selector readables emit on every new reference, so an equal attribution
// keeps the previous object per (workspace, agent, principal) key.
const lastByKey = new Map<string, GoalAttribution | null>();

/**
 * Who set the goal of `agentId` (or, with `principalId`, who wrote a goal
 * notice row), or null when nothing should be shown. Only a shared workspace
 * (`Workspace.memberCount > 1`) shows attribution; a personal one never does,
 * even when the daemon served `goalSetBy`. Fails closed while the presence
 * rows are not the current principal's (`principal.me` unresolved, or a
 * context switch in progress): a stale roster or own principal could show the
 * viewer's name instead of "you", or call someone else "you".
 */
export const selectGoalAttribution = store.createSelector(
  (state, workspaceId: string, agentId: string, principalId?: string): GoalAttribution | null => {
    const workspace = workspaceId
      ? getItem(state.workspace.workspaces, workspaceId as Workspace['id'])
      : undefined;
    let next: GoalAttribution | null = null;
    const ownPrincipalId = state.presence.ownPrincipalId;
    if (
      workspace &&
      (workspace.memberCount ?? 1) > 1 &&
      ownPrincipalId &&
      isPresenceContextCurrent(state)
    ) {
      const snapshot = agentId ? state.agentSessions?.byAgentId[agentId]?.goalSetBy : undefined;
      const roster = state.presence.members[workspaceId];
      next = resolveGoalAttribution({
        principalId: principalId ?? snapshot?.principalId,
        snapshot,
        members: roster ? getItems(roster) : null,
        ownPrincipalId,
      });
    }
    const key = `${workspaceId}\u0000${agentId}\u0000${principalId ?? ''}`;
    const previous = lastByKey.get(key);
    if (previous !== undefined && sameGoalAttribution(previous, next)) return previous;
    if (lastByKey.size > 512) lastByKey.clear();
    lastByKey.set(key, next);
    return next;
  },
);

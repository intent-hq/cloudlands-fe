import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { FocusFrame } from '$features/presence/presence-focus-channel';
import { store } from '../../store';
import {
  selectPresenceContext,
  selectWorkspacePresencePeople,
} from '../presence/presence-selectors';

/** Match the rendered sidebar cap; no subscriptions for overflow or closed workspaces. */
export const PRESENCE_FOLLOW_VISIBLE_LIMIT = 3;
export const selectPresenceFollowScope = store.createSelector((state): string | null => {
  const context = selectPresenceContext.select(state);
  if (!context) return null;
  const follow = state.presenceFollow;
  // Keep the clicked source alive across our own workspace route transition.
  const workspaceId =
    follow?.navigation && follow.context === context
      ? follow.workspaceId
      : state.tabState?.currentTabId;
  if (!workspaceId) return null;
  const people = selectWorkspacePresencePeople
    .select(state, workspaceId)
    .slice(0, PRESENCE_FOLLOW_VISIBLE_LIMIT)
    .filter((person) => person.online);
  return people.length
    ? JSON.stringify([context, workspaceId, people.map((person) => person.principalId)])
    : null;
});
export interface FollowTarget extends FocusFrame {
  scope: string;
  workspaceTitle: string;
}
const EMPTY: Record<string, FollowTarget> = {};
/** Both admitted source presence and a currently reachable workspace row are
 * required. A saved profile or a stale/previous-backend frame is never authority. */
export const selectPresenceFollowTargets = store.createSelector<
  [workspaceId: string],
  Record<string, FollowTarget>
>((state, workspaceId) => {
  const follow = state.presenceFollow;
  const scope = selectPresenceFollowScope.select(state);
  if (!scope || follow?.scope !== scope || follow.workspaceId !== workspaceId) return EMPTY;
  const eligible = new Set(
    selectWorkspacePresencePeople
      .select(state, workspaceId)
      .slice(0, PRESENCE_FOLLOW_VISIBLE_LIMIT)
      .filter((person) => person.online)
      .map((person) => person.principalId),
  );
  const targets: Record<string, FollowTarget> = {};
  for (const [id, frame] of Object.entries(follow.frames)) {
    if (!frame.target || !eligible.has(id)) continue;
    const workspace = getItem(state.workspace.workspaces, WorkspaceId(frame.target.workspaceId));
    if (!workspace || workspace.status === 'Deleted') continue;
    targets[id] = { ...frame, scope, workspaceTitle: workspace.title };
  }
  return targets;
});

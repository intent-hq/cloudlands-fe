import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import {
  DEFAULT_DISCUSSION_ID,
  hasDiscussionPrincipalMentions,
  type DiscussionMessage,
} from '$shared/types/workspace-discussion';
import {
  discussionRow,
  type DiscussionTarget,
} from '../workspace-discussion/workspace-discussion-slice';
import {
  selectDiscussionAuthor,
  selectDiscussionOwner,
  selectDiscussionPrincipalMentionsSupported,
  selectDiscussionReady,
  selectDiscussionTarget,
} from '../workspace-discussion/workspace-discussion-selectors';
import { selectNotificationEnabled } from '../user-preferences/user-preferences-selectors';
import { selectCurrentWorkspaceTabId } from '../tab-state/tab-state-selectors';
import {
  selectPanel,
  selectPanelIds,
  selectRestoreStatus,
} from '../panel-layout/panel-layout-selectors';

/** The action target is retained unchanged through delivery and click admission. */
export const selectDiscussionMentionCandidate = store.createSelector(
  (state, target: DiscussionTarget, messageId: string): DiscussionMessage | null => {
    const current = selectDiscussionTarget.select(state, target.workspaceId, target.conversationId);
    if (!current || current.context !== target.context || current.epoch !== target.epoch)
      return null;
    const row = discussionRow(state.workspaceDiscussion, target.workspaceId, target.conversationId);
    return row?.authorized ? (getItem(row.messages, messageId) ?? null) : null;
  },
);

export const selectDiscussionMentionAdmission = store.createSelector(
  (state, target: DiscussionTarget, messageId: string): DiscussionMessage | 'pending' | null => {
    const message = selectDiscussionMentionCandidate.select(state, target, messageId);
    const principalId = selectDiscussionAuthor.select(state)?.principalId;
    if (
      !message ||
      !principalId ||
      !selectNotificationEnabled.select(state) ||
      !selectDiscussionReady.select(state, target.workspaceId) ||
      (!message.author.agentId && message.author.principalId === principalId) ||
      !hasDiscussionPrincipalMentions(message) ||
      !message.principalMentions?.some((mention) => mention.principalId === principalId)
    )
      return null;
    const supported = selectDiscussionPrincipalMentionsSupported.select(state);
    const conversationsSupported =
      (target.conversationId ?? DEFAULT_DISCUSSION_ID) === DEFAULT_DISCUSSION_ID
        ? true
        : state.workspaceDiscussion.conversationsSupported;
    if (supported === false || conversationsSupported === false) return null;
    if (supported === null || conversationsSupported === null) return 'pending';
    return selectDiscussionReady.select(state, target.workspaceId, target.conversationId)
      ? message
      : null;
  },
);

/** Includes every displayed pane, not just the keyboard-focused panel. */
export const selectDiscussionMentionVisible = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const layoutId = selectCurrentWorkspaceTabId.select(state);
    if (!layoutId) return false;
    return selectPanelIds.select(state, layoutId).some((panelId) => {
      const panel = selectPanel.select(state, layoutId, panelId);
      const tab = panel?.tabs.find((item) => item.id === panel.activeTabId);
      return (
        tab?.type === 'discussion' &&
        (tab.workspaceId ?? layoutId) === workspaceId &&
        (tab.data?.conversationId ?? DEFAULT_DISCUSSION_ID) === conversationId
      );
    });
  },
);

/** Seed replay protection from accepted history without generating any alerts. */
export const selectDiscussionNotificationHistory = store.createSelector((state) => {
  const owner = selectDiscussionOwner.select(state);
  if (!owner || state.workspaceDiscussion?.owner !== owner) return [];
  return Object.entries(state.workspaceDiscussion.byWorkspaceId).flatMap(([workspaceId, rows]) =>
    Object.entries(rows).flatMap(([conversationId, row]) =>
      getItems(row.messages).map((message) =>
        JSON.stringify([owner, workspaceId, conversationId, message.id]),
      ),
    ),
  );
});

/** Stop waiting when authority is lost as well as when the mounted destination is ready. */
export const selectDiscussionNotificationLayout = store.createSelector(
  (state, target: DiscussionTarget, messageId: string): 'ready' | 'pending' | 'denied' => {
    const admission = selectDiscussionMentionAdmission.select(state, target, messageId);
    if (!admission) return 'denied';
    const status = selectRestoreStatus.select(state, target.workspaceId);
    if (status === 'invalid') return 'denied';
    return admission !== 'pending' &&
      (status === 'restored' || status === 'empty') &&
      selectPanelIds.select(state, target.workspaceId).length > 0
      ? 'ready'
      : 'pending';
  },
);

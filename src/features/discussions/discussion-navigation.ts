import { store } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import {
  selectFocusedPanelId,
  selectPanel,
  selectPanelIds,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { openTab, setActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { panelTabsAreEquivalent } from '$store/renderer/slices/panel-layout/panel-tab-identity';
import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { discussionNewRequested } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';

export function openWorkspaceDiscussion(
  workspaceId: string,
  layoutId = workspaceId,
  conversationId = 'default',
  title?: string,
  targetPanelId?: string,
) {
  if (!selectLabsMultiplayerEnabled.select(store.state)) return;
  const panelId =
    targetPanelId ??
    selectFocusedPanelId.select(store.state, layoutId) ??
    selectPanelIds.select(store.state, layoutId)[0];
  if (!panelId) return;
  const panel = selectPanel.select(store.state, layoutId, panelId);
  const destination = {
    type: 'discussion' as const,
    title:
      title ??
      (conversationId === 'new'
        ? m.workspace_discussion_new_title()
        : m.workspace_discussion_title()),
    workspaceId,
    closable: true,
    data: { conversationId },
  };
  const existing = panel?.tabs.find((tab) => panelTabsAreEquivalent(tab, destination));
  if (conversationId === 'new') store.dispatch(discussionNewRequested(workspaceId));
  store.dispatch(
    existing
      ? setActiveTab(layoutId, existing.id, panelId)
      : openTab(layoutId, destination, panelId, undefined, true, undefined, true),
  );
}

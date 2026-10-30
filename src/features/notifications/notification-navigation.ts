/**
 * Shared notification click → navigation routing.
 *
 * Extracted verbatim from the renderer notification IPC middleware
 * (`src/store/renderer/middlewares/notification-ipc-service.ts`) so both
 * delivery paths route clicks identically:
 *   - Electron: the main-process NotificationService's `notification:navigate`
 *     renderer event (notification-ipc-service middleware).
 *   - Web: the browser Notification `click` handler in
 *     `web-notification-service.ts`.
 *
 * Not under `utils/` because it is NOT dependency-light: it dispatches to the
 * app store and triggers SvelteKit navigation — it is a feature client module
 * shared by the two listeners above.
 */
import { discussionNotificationLayoutRequested } from '$store/renderer/slices/notifications/notifications-slice';
import { openWorkspaceDiscussion } from '$features/discussions/discussion-navigation';
import { selectDiscussionMentionAdmission } from '$store/renderer/slices/notifications/notifications-selectors';
import type { DiscussionTarget } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';

const logger = createLogger('NotificationNavigation');

/** Payload of `notification:navigate` (sent on notification click). */
export interface NotificationNavigatePayload {
  workspaceId?: string;
  /** Set for chief-of-staff completions — route to the homepage Assistant. */
  chief?: boolean;
  /** Chief chat thread (agent) to select in the Assistant panel. */
  agentId?: string;
  discussion?: { target: DiscussionTarget; messageId: string };
}

/**
 * Route a notification click: activate the workspace tab (adding it to the
 * tab strip when it is not open) and `goto(/workspace/{workspaceId})`,
 * guarding null/missing payloads. Like every other workspace entry point
 * (deep links, attention "Switch To", link handler), the tab is opened before
 * navigating — the route alone does not add a closed workspace to the strip.
 * Chief-of-staff payloads (`chief: true` or the chief
 * virtual workspace id) open the homepage Assistant and select the chat
 * thread instead — the chief workspace page is hidden. No-ops in the HUD
 * pop-out window so a stray `notification:navigate` IPC can never replace
 * the /hud route with a workspace view. Never rejects; errors are logged.
 */
export async function handleNotificationNavigate(
  data?: NotificationNavigatePayload | null,
): Promise<void> {
  if (!data?.workspaceId) {
    return;
  }

  // The HUD window registers the same IPC listeners as every renderer; the
  // main process avoids targeting it, but guard here too (defense in depth).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/hud')) {
    logger.debug('Ignoring notification navigate in HUD window', {
      workspaceId: data.workspaceId,
    });
    return;
  }

  if (data.discussion) {
    const { target, messageId } = data.discussion;
    const admitted = () => {
      const result = selectDiscussionMentionAdmission.select(appStore.state, target, messageId);
      return result !== null && result !== 'pending';
    };
    if (target.workspaceId !== data.workspaceId || !admitted()) return;
    try {
      appStore.dispatch(openWorkspaceTab(target.workspaceId));
      await navigateToRoute(`/workspace/${encodeURIComponent(target.workspaceId)}`);
      if (!admitted()) return;
      const ready = await appStore.dispatch(
        discussionNotificationLayoutRequested(target, messageId),
      );
      if (!ready || !admitted()) return;
      openWorkspaceDiscussion(target.workspaceId, target.workspaceId, target.conversationId);
    } catch (error) {
      logger.warn('Failed to open discussion from notification click', { error });
    }
    return;
  }

  // Chief-of-staff completions: never navigate to the hidden chief workspace
  // page — open the homepage Assistant and select the chat thread.
  if (data.chief === true || data.workspaceId === CHIEF_WORKSPACE_ID) {
    try {
      if (data.agentId) {
        appStore.dispatch(setChiefActiveAgentId(data.agentId));
      }
      appStore.dispatch(openPanel('chief'));
      await navigateToRoute('/');
    } catch (error) {
      logger.warn('Failed to open Assistant panel from notification click', { error });
    }
    return;
  }

  try {
    appStore.dispatch(openWorkspaceTab(data.workspaceId));
    await navigateToRoute(`/workspace/${data.workspaceId}`);
  } catch (error) {
    logger.warn('Failed to navigate from notification click', {
      workspaceId: data.workspaceId,
      error,
    });
  }
}

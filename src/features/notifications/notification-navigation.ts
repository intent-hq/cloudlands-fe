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
import { navigateToRoute } from '$lib/utils/navigation.client';
import { store as appStore } from '$store/renderer/store';
import { createLogger } from '$lib/utils/client-logger';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

const logger = createLogger('NotificationNavigation');

/** Payload of `notification:navigate` (sent on notification click). */
export interface NotificationNavigatePayload {
  workspaceId?: string;
  /** Set for chief-of-staff completions — route to the sidebar Assistant panel. */
  chief?: boolean;
  /** Chief chat thread (agent) to select in the Assistant panel. */
  agentId?: string;
}

/**
 * Route a notification click: `goto(/workspace/{workspaceId})`, guarding
 * null/missing payloads. Chief-of-staff payloads (`chief: true` or the chief
 * virtual workspace id) open the sidebar Assistant panel and select the chat
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

  // Chief-of-staff completions: never navigate to the hidden chief workspace
  // page — open the sidebar Assistant panel and select the chat thread.
  if (data.chief === true || data.workspaceId === CHIEF_WORKSPACE_ID) {
    try {
      if (data.agentId) {
        appStore.dispatch(setChiefActiveAgentId(data.agentId));
      }
      appStore.dispatch(openPanel('chief'));
    } catch (error) {
      logger.warn('Failed to open Assistant panel from notification click', { error });
    }
    return;
  }

  try {
    await navigateToRoute(`/workspace/${data.workspaceId}`);
  } catch (error) {
    logger.warn('Failed to navigate from notification click', {
      workspaceId: data.workspaceId,
      error,
    });
  }
}

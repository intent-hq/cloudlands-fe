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
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import type { WorkspaceWindowTarget } from '$shared/workspace-window-target';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import {
  openPanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

const logger = createLogger('NotificationNavigation');
let navigationGeneration = 0;

/** Payload of `notification:navigate` (sent on notification click). */
export interface NotificationNavigatePayload {
  workspaceId?: string;
  /** Set for chief-of-staff completions — route to the homepage Assistant. */
  chief?: boolean;
  /** Exact conversation to select in the target workspace or Assistant. */
  agentId?: string;
  workspaceTarget?: WorkspaceWindowTarget;
}

function openWorkspaceTarget(data: NotificationNavigatePayload): void {
  if (!data.workspaceId || !data.workspaceTarget) return;
  const target = data.workspaceTarget;
  if (target.type === 'note') {
    appStore.dispatch(openWorkspaceNote(data.workspaceId, target.noteId));
  } else {
    appStore.dispatch(
      openWorkspaceFile(data.workspaceId, target.filePath, {
        ...(target.line !== undefined ? { line: target.line } : {}),
        ...(target.gitRootId ? { gitRootId: target.gitRootId } : {}),
        ...(target.gitRootPath ? { gitRootPath: target.gitRootPath } : {}),
        filePathIsLiteral: true,
      }),
    );
  }
}

/**
 * Route a notification click: `goto(/workspace/{workspaceId})`, guarding
 * null/missing payloads. Chief-of-staff payloads (`chief: true` or the chief
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
  if (
    typeof window !== 'undefined' &&
    /^\/(?:hud|dock|annotation|dev-console)(?:\/|$)/.test(window.location.pathname)
  ) {
    logger.debug('Ignoring notification navigate in HUD window', {
      workspaceId: data.workspaceId,
    });
    return;
  }
  const generation = ++navigationGeneration;

  // Chief-of-staff completions: never navigate to the hidden chief workspace
  // page — open the homepage Assistant and select the chat thread.
  if (data.chief === true || data.workspaceId === CHIEF_WORKSPACE_ID) {
    try {
      if (data.agentId) {
        appStore.dispatch(setChiefActiveAgentId(data.agentId));
      }
      appStore.dispatch(openPanel('chief'));
      await navigateToRoute('/');
      if (generation === navigationGeneration) openWorkspaceTarget(data);
    } catch (error) {
      logger.warn('Failed to open Assistant panel from notification click', { error });
    }
    return;
  }

  try {
    await navigateToRoute(`/workspace/${encodeURIComponent(data.workspaceId)}`);
    if (data.agentId && generation === navigationGeneration) {
      appStore.dispatch(openAgentTabRequested(data.workspaceId, { agentId: data.agentId }));
    }
    if (generation === navigationGeneration) openWorkspaceTarget(data);
  } catch (error) {
    logger.warn('Failed to navigate from notification click', {
      workspaceId: data.workspaceId,
      error,
    });
  }
}

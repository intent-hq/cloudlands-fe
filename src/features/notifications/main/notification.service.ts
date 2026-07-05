/**
 * Notification Service
 *
 * Main process service that shows desktop notifications when agents complete.
 * Subscribes to workspace event bus for agent:idle events and displays native OS notifications.
 *
 * Persisted notification preferences live on the daemon under `notifications.*`
 * (PROTOCOL.md §5.12); the legacy `notificationSettings` electron-store bag is
 * retired. The renderer already syncs `notifications.enabled` to Redux from the
 * daemon-backed settings catalog; here we hydrate a small cache at process
 * start and refresh on demand.
 */

import {
  app,
  BrowserWindow,
  Notification,
} from 'electron';
import { Logger } from '../../../shared/logger';
import type { AgentIdleEvent } from '../../events/types';
import { AgentBackendHandler } from '../../agent/main/agent-backend-handler.service';
import {
  getWindowIdsForWorkspace,
  sendToWorkspaceWindows,
} from '../../system/main/system.ipc';

const logger = new Logger('NotificationService');

/** Daemon setting path for the notifications-enabled toggle (§5.12). */
const SETTING_PATH_ENABLED = 'notifications.enabled';

/** Cached notification-enabled preference, hydrated lazily from the daemon. */
let cachedEnabled: boolean | null = null;
let hydrationPromise: Promise<void> | null = null;

async function fetchEnabled(): Promise<boolean> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  const result = (await getBackendClient().request('settings.get', {
    path: SETTING_PATH_ENABLED,
  })) as { value?: unknown } | null;
  const value = result?.value;
  // Default to enabled when the setting is unset or malformed (matches the
  // daemon catalog default and the legacy electron-store default).
  return value === false ? false : true;
}

/** Hydrate `cachedEnabled` once from the daemon; safe to call repeatedly. */
async function hydrate(): Promise<void> {
  if (cachedEnabled !== null) return;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      cachedEnabled = await fetchEnabled();
    } catch (error) {
      logger.warn('Failed to hydrate notifications.enabled from daemon', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Default open — same as the daemon catalog default.
      cachedEnabled = true;
    }
  })();
  return hydrationPromise;
}

/**
 * Map specialist ID to display name
 */
const SPECIALIST_DISPLAY_NAMES: Record<string, string> = {
  'spec-writer': 'Coordinator',
  implementor: 'Implementor',
  verifier: 'Verifier',
};

/**
 * Get display name for a specialist type
 */
function getSpecialistDisplayName(specialist?: string): string {
  if (!specialist) return 'Agent';
  return SPECIALIST_DISPLAY_NAMES[specialist] || 'Agent';
}

/**
 * Notification content for display
 */
interface NotificationContent {
  title: string;
  body: string;
}

export class NotificationService {
  private workspaceId: string;

  private unsubscribe?: () => void;
  private activeNotifications = new Set<Notification>();

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    // Kick off hydration eagerly; the first `handleAgentIdle` awaits it.
    void hydrate();
  }

  /**
   * Start the notification service (no-op; events are now delivered via sagas).
   */
  start(): void {
    logger.info('NotificationService started (saga-driven)', { workspaceId: this.workspaceId });
  }

  /**
   * Stop the notification service (no-op; events are now delivered via sagas).
   */
  stop(): void {
    logger.info('NotificationService stopped', { workspaceId: this.workspaceId });
  }

  /**
   * Handle agent:idle event.
   * Called by event-triggered-sagas when an agent:idle workspace event is accepted.
   */
  async handleAgentIdle(event: AgentIdleEvent): Promise<void> {
    try {
      // Ensure the enabled flag is hydrated before we consult it.
      await hydrate();

      if (cachedEnabled === false) {
        logger.debug('Notifications disabled', { workspaceId: this.workspaceId });
        return;
      }

      // Skip background agents - only notify for user-facing agents
      if (event.data.isBackground === true) {
        logger.debug('Skipping notification for background agent', {
          workspaceId: this.workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Check if any workspace window is focused. The legacy
      // `showWhenFocused` electron-store field had no writer and no daemon
      // peer, so its effective value was always `false` — preserve that
      // behavior: skip notifications when a workspace window is focused.
      const workspaceWindowIds = getWindowIdsForWorkspace(this.workspaceId);
      const workspaceWindows = workspaceWindowIds
        .map((id) => BrowserWindow.fromId(id))
        .filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
      const anyFocused = workspaceWindows.some((w) => w.isFocused());
      if (anyFocused) {
        logger.debug('Workspace window is focused, skipping notification', {
          workspaceId: this.workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Check if any other agents are still streaming in this workspace
      const handler = AgentBackendHandler.getInstance();
      const activeStreams = handler.getActiveStreams();
      const otherActiveStreams = activeStreams.filter(
        (stream) =>
          stream.workspaceId === this.workspaceId && stream.agentId !== event.data.agentId,
      );

      if (otherActiveStreams.length > 0) {
        logger.debug('Other agents still active, skipping notification', {
          workspaceId: this.workspaceId,
          agentName: event.data.agentName,
          otherActiveCount: otherActiveStreams.length,
        });
        return;
      }

      // Build notification content with specialist type and task title
      const content = await this.buildNotificationContent(event);

      // Show notification — pick first workspace window for click-to-focus
      const focusWindow = workspaceWindows[0] ?? BrowserWindow.getAllWindows()[0];
      this.showNotification(content, focusWindow, this.workspaceId);
    } catch (error) {
      logger.error('Failed to handle agent:idle event', error as Error);
    }
  }

  /**
   * Build notification content from event data
   * Uses specialist display name and task title instead of agent name
   */
  private async buildNotificationContent(event: AgentIdleEvent): Promise<NotificationContent> {
    const { specialist, taskTitle } = event.data;

    // Get display name for the agent type
    const displayName = getSpecialistDisplayName(specialist);

    // Get workspace title for context
    let workspaceTitle: string | undefined;
    try {
      const { workspaceService } = await import('../../workspace/main/workspace.service');
      const workspaceResult = await workspaceService.getWorkspace(this.workspaceId as any);
      if (workspaceResult.ok && workspaceResult.data?.title) {
        workspaceTitle = workspaceResult.data.title;
      }
    } catch {
      // Ignore - use default without workspace title
    }

    // Build title: include workspace name for context
    // Format: "WorkspaceName - Coordinator" or "WorkspaceName - Implementor: Task Title"
    let title = displayName;
    if (taskTitle) {
      // Truncate task title if too long for notification
      const truncatedTitle = taskTitle.length > 40 ? `${taskTitle.slice(0, 37)}...` : taskTitle;
      title = `${displayName}: ${truncatedTitle}`;
    }

    // Prepend workspace title if available
    if (workspaceTitle) {
      // Truncate workspace title if needed to keep notification readable
      const truncatedWorkspace =
        workspaceTitle.length > 30 ? `${workspaceTitle.slice(0, 27)}...` : workspaceTitle;
      title = `${truncatedWorkspace} - ${title}`;
    }

    // Build body
    const body = taskTitle ? 'Task completed' : 'Finished';

    return { title, body };
  }

  /**
   * Show a desktop notification
   */
  private showNotification(content: NotificationContent, mainWindow?: BrowserWindow, workspaceId?: string): void {
    try {
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        // Still send the sound event even if notifications aren't supported
        sendToWorkspaceWindows(this.workspaceId, 'notification:show', {
          title: content.title,
          body: content.body,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const notification = new Notification({
        title: content.title,
        body: content.body,
      });

      // Keep a strong reference to prevent GC before user interaction
      this.activeNotifications.add(notification);

      // Focus workspace window on click and navigate to the correct workspace
      notification.on('click', () => {
        this.activeNotifications.delete(notification);

        if (process.platform === 'darwin') {
          app.show();
        }

        if (mainWindow) {
          if (mainWindow.isDestroyed()) {
            return;
          }
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
          if (workspaceId && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('notification:navigate', { workspaceId });
          }
        }
      });

      notification.on('close', () => {
        this.activeNotifications.delete(notification);
      });

      // Log any errors that occur during notification display
      notification.on('failed', (_event, error) => {
        this.activeNotifications.delete(notification);
        logger.error('Notification failed to show', { error });
      });

      try {
        notification.show();
      } catch (error) {
        this.activeNotifications.delete(notification);
        logger.error('Notification.show() threw', error as Error);
        return;
      }

      // Send notification:show event to workspace windows for sound playback
      sendToWorkspaceWindows(this.workspaceId, 'notification:show', {
        title: content.title,
        body: content.body,
        timestamp: new Date().toISOString(),
      });

      logger.info('Notification shown', {
        workspaceId: this.workspaceId,
        title: content.title,
        body: content.body,
      });
    } catch (error) {
      logger.error('Failed to show notification', error as Error);
    }
  }

  /**
   * Show a test notification
   * @returns Object with success status and any error message
   */
  showTestNotification(): { success: boolean; error?: string } {
    try {
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        return {
          success: false,
          error: 'Desktop notifications are not supported on this platform',
        };
      }

      const wsWindowIds = getWindowIdsForWorkspace(this.workspaceId);
      const focusWindow = wsWindowIds.length > 0
        ? BrowserWindow.fromId(wsWindowIds[0]) ?? undefined
        : BrowserWindow.getAllWindows()[0];

      this.showNotification({ title: 'Agent', body: 'Test notification' }, focusWindow ?? undefined);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to show test notification', error as Error);
      return { success: false, error: errorMessage };
    }
  }
}

// Singleton instances per workspace
const instances = new Map<string, NotificationService>();

/**
 * Get or create a NotificationService for a workspace
 */
export function getNotificationService(workspaceId: string): NotificationService {
  let service = instances.get(workspaceId);
  if (!service) {
    service = new NotificationService(workspaceId);
    instances.set(workspaceId, service);
  }
  return service;
}

/**
 * Dispose of a workspace's notification service
 */
export function disposeNotificationService(workspaceId: string): void {
  const service = instances.get(workspaceId);
  if (service) {
    service.stop();
    instances.delete(workspaceId);
  }
}

/**
 * Test-only: reset the cached daemon-hydrated preference so tests can
 * re-hydrate against a fresh mock. Not exported for production use.
 * @internal
 */
export function __resetNotificationCacheForTesting(): void {
  cachedEnabled = null;
  hydrationPromise = null;
}

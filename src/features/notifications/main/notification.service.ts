/**
 * Notification Service
 *
 * Main process service that shows desktop notifications when agents complete.
 * Holds ONE app-wide long-lived daemon `events.subscribe` subscription for
 * `agent:idle` events (PROTOCOL.md §6.1–§6.3) with `workspaceId` omitted so
 * events are delivered across ALL workspaces, and displays native OS
 * notifications routed per-event by `event.workspaceId`.
 *
 * Persisted notification preferences live on the daemon under `notifications.*`
 * (PROTOCOL.md §5.12); the legacy `notificationSettings` electron-store bag is
 * retired. Preferences are re-fetched on each idle event so settings toggles
 * take effect without a relaunch; the last-known values are kept as a fallback
 * when the daemon is unreachable.
 */

import {
  app,
  BrowserWindow,
  Notification,
} from 'electron';
import { Logger } from '../../../shared/logger';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '../../../shared/types/branded-ids';
import type { AgentIdleEvent } from '../../events/types';
import type {
  ConnectionStatus,
  JsonRpcNotification,
} from '../../backend/main/json-rpc-client';
import { getBackendClient, onBackendReconnected } from '../../backend/main/backend.ipc';
import {
  getFocusedWindowWorkspaceId,
  getWindowIdsForWorkspace,
  sendToWorkspaceWindows,
} from '../../system/main/system.ipc';

const logger = new Logger('NotificationService');

/** Daemon setting path for the notifications-enabled toggle (§5.12). */
const SETTING_PATH_ENABLED = 'notifications.enabled';

/** Daemon setting path for the "only when unfocused" toggle (§5.12). */
const SETTING_PATH_SOUND_ONLY_WHEN_UNFOCUSED = 'notifications.soundOnlyWhenUnfocused';

/** Daemon-owned notification preferences consulted per idle event. */
interface NotificationPrefs {
  enabled: boolean;
  soundOnlyWhenUnfocused: boolean;
}

/** Daemon catalog defaults — also the fallback when the daemon is unreachable. */
const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  soundOnlyWhenUnfocused: true,
};

/** Last-known preferences, used as a fallback when a refresh fails. */
let cachedPrefs: NotificationPrefs | null = null;

async function fetchBoolSetting(path: string, defaultValue: boolean): Promise<boolean> {
  const result = (await getBackendClient().request('settings.get', {
    path,
  })) as { value?: unknown } | null;
  const value = result?.value;
  // Fall back to the daemon catalog default when unset or malformed.
  return typeof value === 'boolean' ? value : defaultValue;
}

/**
 * Fetch fresh `notifications.*` preferences from the daemon. On failure the
 * last-known values (or the catalog defaults) are returned so notifications
 * stay default-open, matching the legacy electron-store behavior.
 */
async function refreshPrefs(): Promise<NotificationPrefs> {
  try {
    const [enabled, soundOnlyWhenUnfocused] = await Promise.all([
      fetchBoolSetting(SETTING_PATH_ENABLED, DEFAULT_PREFS.enabled),
      fetchBoolSetting(
        SETTING_PATH_SOUND_ONLY_WHEN_UNFOCUSED,
        DEFAULT_PREFS.soundOnlyWhenUnfocused,
      ),
    ]);
    cachedPrefs = { enabled, soundOnlyWhenUnfocused };
  } catch (error) {
    logger.warn('Failed to fetch notifications.* settings from daemon', {
      error: error instanceof Error ? error.message : String(error),
    });
    cachedPrefs = cachedPrefs ?? { ...DEFAULT_PREFS };
  }
  return cachedPrefs;
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
  private started = false;
  private subscriptionId?: string;
  /** Guards against stale in-flight `events.subscribe` calls (bumped on stop/reconnect). */
  private subscribeEpoch = 0;
  private notificationListener?: (n: JsonRpcNotification) => void;
  private reconnectDisposer?: () => void;
  /** Detaches the pending connect-retry `status` listener, when armed. */
  private statusRetryDisposer?: () => void;
  private activeNotifications = new Set<Notification>();

  constructor() {
    // Warm the preferences cache eagerly; each `handleAgentIdle` re-fetches.
    void refreshPrefs();
  }

  /**
   * Start the notification service: attach ONE long-lived daemon `agent:idle`
   * subscription covering all workspaces (PROTOCOL.md §6.1, `workspaceId`
   * omitted) and re-issue it on backend reconnect (RESUB-1).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    logger.info('NotificationService started');
    void this.attachIdleSubscription();
  }

  /**
   * Stop the notification service: detach the daemon notification listener
   * and best-effort unsubscribe the `agent:idle` subscription.
   */
  stop(): void {
    this.started = false;
    // Invalidate any in-flight subscribe so it can't resurrect a stale id.
    this.subscribeEpoch++;
    this.reconnectDisposer?.();
    this.reconnectDisposer = undefined;
    this.clearStatusRetry();
    const listener = this.notificationListener;
    this.notificationListener = undefined;
    const subscriptionId = this.subscriptionId;
    this.subscriptionId = undefined;
    void (async () => {
      try {
        const client = getBackendClient();
        if (listener) client.off('notification', listener);
        if (subscriptionId) {
          await client.request('events.unsubscribe', { subscriptionId });
        }
      } catch (error) {
        logger.debug('Failed to tear down agent:idle subscription', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    logger.info('NotificationService stopped');
  }

  /**
   * Attach the daemon notification listener and issue the initial
   * `events.subscribe`. Mirrors the terminal-registry / script-manager
   * long-lived subscription pattern: the listener persists across reconnects
   * (same singleton client); only the subscription id is re-issued.
   *
   * The notification listener and reconnect disposer are attached
   * synchronously (before the first `await`), so a later `stop()` always
   * observes and detaches them — it can never interleave with a
   * half-attached state.
   */
  private async attachIdleSubscription(): Promise<void> {
    try {
      const client = getBackendClient();
      const listener = (n: JsonRpcNotification): void => {
        if (n.method !== 'events.event') return;
        const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
        const subId =
          typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
        // Strict match: the shared client also carries notifications for
        // renderer-proxied subscriptions; only our own subscription's events
        // may trigger a desktop notification.
        if (!this.subscriptionId || subId !== this.subscriptionId) return;
        const event = params?.event as { type?: unknown; workspaceId?: unknown } | undefined;
        if (!event || event.type !== 'agent:idle') return;
        // Per-event routing (suppression, prefs, focus gating, sound/click
        // delivery) keys off the event's workspaceId; an event without one
        // cannot be routed.
        if (typeof event.workspaceId !== 'string') return;
        void this.handleAgentIdle(event as unknown as AgentIdleEvent);
      };
      this.notificationListener = listener;
      client.on('notification', listener);
      this.reconnectDisposer = onBackendReconnected(() => {
        // The daemon dropped every in-memory subscription on reconnect; the
        // stale id belonged to the previous connection. Invalidate any
        // in-flight subscribe from before the reconnect and re-issue.
        this.subscribeEpoch++;
        this.subscriptionId = undefined;
        if (!this.started) return;
        void this.subscribeToIdleEvents();
      });
      await this.subscribeToIdleEvents();
    } catch (error) {
      logger.warn('Failed to attach agent:idle subscription', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Issue `events.subscribe` for `agent:idle` across ALL workspaces —
   * `workspaceId` is deliberately omitted (§6.1) so completions in
   * workspaces without an open window/tab still notify.
   */
  private async subscribeToIdleEvents(): Promise<void> {
    const epoch = this.subscribeEpoch;
    try {
      const result = (await getBackendClient().request('events.subscribe', {
        eventTypes: ['agent:idle'],
      })) as { subscriptionId?: string } | undefined;
      const subscriptionId = result?.subscriptionId;
      if (epoch !== this.subscribeEpoch || !this.started) {
        // stop() or a reconnect ran while subscribe was in flight; this id
        // belongs to a torn-down generation. Best-effort release it instead
        // of overwriting the current one.
        if (subscriptionId) {
          void getBackendClient()
            .request('events.unsubscribe', { subscriptionId })
            .catch(() => {});
        }
        return;
      }
      // Concurrent same-epoch subscribes (reconnect handler racing an armed
      // status-retry) can both land here; release the superseded id so it
      // doesn't leak daemon-side for the connection lifetime.
      const previousId = this.subscriptionId;
      this.subscriptionId = subscriptionId;
      if (previousId && previousId !== subscriptionId) {
        void getBackendClient()
          .request('events.unsubscribe', { subscriptionId: previousId })
          .catch(() => {});
      }
      this.clearStatusRetry();
    } catch (error) {
      logger.warn(
        'events.subscribe for agent:idle failed; will retry on the next connected transition',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // Initial-connect gap (RESUB-1 covers reconnects only): when start()
      // runs before the daemon client's FIRST successful connect, this
      // subscribe fails and `reconnected` never fires (it requires an
      // earlier connected state). Arm a `status` listener so the next
      // `connected` transition re-issues the subscribe.
      if (epoch === this.subscribeEpoch && this.started) {
        this.armStatusRetry();
      }
    }
  }

  /** Re-issue `events.subscribe` on the client's next `connected` transition. */
  private armStatusRetry(): void {
    if (this.statusRetryDisposer) return;
    const client = getBackendClient();
    const listener = (status: ConnectionStatus): void => {
      if (status !== 'connected') return;
      this.clearStatusRetry();
      // Guard against double-subscribe: the reconnect handler (or a late
      // in-flight subscribe) may have already produced a live id.
      if (!this.started || this.subscriptionId) return;
      void this.subscribeToIdleEvents();
    };
    client.on('status', listener);
    this.statusRetryDisposer = () => client.off('status', listener);
  }

  private clearStatusRetry(): void {
    this.statusRetryDisposer?.();
    this.statusRetryDisposer = undefined;
  }

  /**
   * Handle an agent:idle event delivered by the daemon subscription. All
   * per-workspace behavior (suppression, focus gating, sound and click
   * routing) keys off `event.workspaceId`.
   */
  async handleAgentIdle(event: AgentIdleEvent): Promise<void> {
    try {
      const workspaceId = event.workspaceId;
      // Fresh read so settings toggles take effect without a relaunch.
      const prefs = await refreshPrefs();

      if (!prefs.enabled) {
        logger.debug('Notifications disabled', { workspaceId });
        return;
      }

      // Fast path: explicit background flag on the event payload.
      if (event.data.isBackground === true) {
        logger.debug('Skipping notification for background agent', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // `agent.list` (PROTOCOL.md §5.5) serves two purposes: AgentLite
      // `metadata` carries `isBackground`/`specialist` (absent from the
      // daemon idle payload), and `isStreaming`/`isResponding` feed the
      // other-agents-active suppression gate below.
      const agentList = (await getBackendClient().request('agent.list', {
        workspaceId,
      })) as {
        agents?: Array<{
          id?: string;
          isStreaming?: boolean;
          isResponding?: boolean;
          metadata?: { isBackground?: boolean; specialist?: string };
        }>;
      } | undefined;
      const agents = agentList?.agents ?? [];
      const idleAgent = agents.find((agent) => agent.id === event.data.agentId);

      // Skip background agents — delegated child completions stay quiet.
      if (idleAgent?.metadata?.isBackground === true) {
        logger.debug('Skipping notification for background agent (metadata)', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      const otherActiveAgents = agents.filter(
        (agent) =>
          (agent.isStreaming === true || agent.isResponding === true) &&
          agent.id !== event.data.agentId,
      );

      if (otherActiveAgents.length > 0) {
        logger.debug('Other agents still active, skipping notification', {
          workspaceId,
          agentName: event.data.agentName,
          otherActiveCount: otherActiveAgents.length,
        });
        return;
      }

      // Build notification content with specialist type and task title;
      // enrich with `metadata.specialist` when the payload lacks it.
      const content = await this.buildNotificationContent({
        ...event,
        data: {
          ...event.data,
          specialist: event.data.specialist ?? idleAgent?.metadata?.specialist,
        },
      } as AgentIdleEvent);

      // Focus gate for the OS banner: `soundOnlyWhenUnfocused` ON suppresses
      // the banner only while the focused window is VIEWING the event's own
      // workspace; OFF shows it even when focused. The `notification:show`
      // renderer event is ALWAYS sent regardless of focus so the renderer
      // sound gate decides on its own.
      const workspaceWindowIds = getWindowIdsForWorkspace(workspaceId);
      const workspaceWindows = workspaceWindowIds
        .map((id) => BrowserWindow.fromId(id))
        .filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
      const focusedViewingWorkspace = getFocusedWindowWorkspaceId() === workspaceId;
      if (focusedViewingWorkspace && prefs.soundOnlyWhenUnfocused) {
        logger.debug('Focused window is viewing the workspace, suppressing OS banner', {
          workspaceId,
          agentName: event.data.agentName,
        });
        this.sendShowEvent(content, workspaceId);
        return;
      }

      // Show notification — prefer a window with the workspace open for
      // click-to-focus; otherwise fall back to the focused (or any) window,
      // which navigates to the workspace on click.
      const focusWindow =
        workspaceWindows[0] ??
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows()[0];
      this.showNotification(content, focusWindow ?? undefined, workspaceId, event.data.agentId);
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

    // Chief-of-staff completions: the chief "workspace" is a hidden virtual
    // workspace, so title with the chat thread name instead of
    // "<workspaceTitle> - <specialist>".
    if (event.workspaceId === CHIEF_WORKSPACE_ID) {
      const chatName = event.data.agentName;
      const truncatedChatName =
        chatName && chatName.length > 40 ? `${chatName.slice(0, 37)}...` : chatName;
      return {
        title: truncatedChatName ? `Assistant — ${truncatedChatName}` : 'Assistant',
        body: taskTitle ? 'Task completed' : 'Finished',
      };
    }

    // Get display name for the agent type
    const displayName = getSpecialistDisplayName(specialist);

    // Get workspace title for context
    let workspaceTitle: string | undefined;
    try {
      const { workspaceService } = await import('../../workspace/main/workspace.service');
      const workspaceResult = await workspaceService.getWorkspace(WorkspaceId(event.workspaceId));
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
   * Send the `notification:show` renderer event so the renderer can play the
   * notification sound. Sent regardless of window focus or banner suppression.
   * Delivered to windows with the event's workspace open; when none exist
   * (workspace not open anywhere) it falls back to the focused (or any)
   * window so the sound still plays.
   */
  private sendShowEvent(content: NotificationContent, workspaceId?: string): void {
    const payload = {
      title: content.title,
      body: content.body,
      timestamp: new Date().toISOString(),
    };
    if (workspaceId && getWindowIdsForWorkspace(workspaceId).length > 0) {
      sendToWorkspaceWindows(workspaceId, 'notification:show', payload);
      return;
    }
    const fallbackWindow =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (
      fallbackWindow &&
      !fallbackWindow.isDestroyed() &&
      !fallbackWindow.webContents.isDestroyed()
    ) {
      fallbackWindow.webContents.send('notification:show', payload);
    }
  }

  /**
   * Show a desktop notification
   */
  private showNotification(
    content: NotificationContent,
    mainWindow?: BrowserWindow,
    workspaceId?: string,
    agentId?: string,
  ): void {
    try {
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        // Still send the sound event even if notifications aren't supported
        this.sendShowEvent(content, workspaceId);
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
            // Chief completions route to the sidebar Assistant panel (the
            // chief workspace page is hidden); everything else keeps the
            // bare `{ workspaceId }` payload.
            const payload =
              workspaceId === CHIEF_WORKSPACE_ID
                ? { workspaceId, chief: true, ...(agentId ? { agentId } : {}) }
                : { workspaceId };
            mainWindow.webContents.send('notification:navigate', payload);
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
      this.sendShowEvent(content, workspaceId);

      logger.info('Notification shown', {
        workspaceId,
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

      const focusWindow =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

      this.showNotification({ title: 'Agent', body: 'Test notification' }, focusWindow ?? undefined);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to show test notification', error as Error);
      return { success: false, error: errorMessage };
    }
  }
}

// App-wide singleton — one global agent:idle subscription for all workspaces.
let instance: NotificationService | null = null;

/**
 * Get (or lazily create) the app-wide NotificationService. Started once at
 * app boot; there is no per-workspace lifecycle.
 */
export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new NotificationService();
  }
  return instance;
}

/**
 * Test-only: reset the cached daemon-hydrated preferences so tests can
 * re-hydrate against a fresh mock. Not exported for production use.
 * @internal
 */
export function __resetNotificationCacheForTesting(): void {
  cachedPrefs = null;
}

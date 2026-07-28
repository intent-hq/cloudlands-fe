/**
 * Web-platform notification service — the browser-Notification-API substitute
 * for the Electron main-process NotificationService, which cannot run on web
 * (there is no main process, so `agent:idle` → OS notification →
 * `notification:show`/`notification:navigate` never happens).
 *
 * Active ONLY when `getPlatform() === 'web'` (NOT `isElectron()`, which is
 * true under the dev browser mock). On Electron this middleware registers
 * nothing and the native pipeline is untouched.
 *
 * Event source: the daemon `events.subscribe` firehose the renderer already
 * receives — `daemon-events-bridge.client.ts` re-emits `agent:idle` onto the
 * legacy mock-IPC channel (`relayLegacyIpcEvent`), which this service listens
 * on. Trigger conditions, suppression rules, and payload shape are a port of
 * `main/notification.service.ts#handleAgentIdle`:
 *   - `notifications.enabled` off → skip (read from the renderer store, which
 *     the user-preferences-notification-persistence middleware keeps in sync
 *     with the daemon `notifications.*` catalog).
 *   - background agents (event fast path or `agent.list` metadata) → skip.
 *   - other agents still streaming/responding in the workspace → skip.
 *   - focused + viewing the event's workspace + `soundOnlyWhenUnfocused` →
 *     suppress the banner but still run the sound gate (the Electron
 *     `notification:show` event is ALWAYS sent regardless of focus).
 *     Suppression parity note: Electron keys this off the FOCUSED WINDOW
 *     viewing the workspace (multi-window); the web tab is a single window,
 *     so it collapses to `document.hasFocus()` + active-workspace check.
 *   - title/body built by the shared pure port of
 *     `buildNotificationContent` (utils/notification-content.ts).
 *
 * Permission is requested LAZILY at the first notification attempt (or via
 * the settings test button → notification-bridge-seeder) — never at boot.
 * 'denied'/'default' degrade silently (skip the banner, log once); the sound
 * gate still runs, mirroring Electron's unsupported-Notification fallback.
 *
 * Click behavior mirrors `notification:navigate`: focus the tab and route via
 * the shared `handleNotificationNavigate` (workspace page, or chief → sidebar
 * Assistant panel + thread selection).
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import type { StoreState } from '$store/renderer/types';
import { addMockIpcListener } from '$shared/ipc-mock-router';
import { backendRequest } from '$lib/client/live/backend-transport';
import { getPlatform } from '$lib/utils/platform-capabilities';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { AgentIdleEvent } from '$features/events/types';
import { buildNotificationContent, type NotificationContent } from './utils/notification-content';
import { handleNotificationNavigate } from './notification-navigation';
import { playNotificationSoundPerSettings } from './notification-sound-gate';

const logger = createLogger('WebNotificationService');

let installed = false;
/** Log the missing-permission skip once, not on every idle event. */
let loggedPermissionSkip = false;
/** In-flight permission prompt, shared so concurrent idle events coalesce
 * into ONE `Notification.requestPermission()` call (overlapping prompts throw
 * or misbehave in some browsers). */
let pendingPermissionRequest: Promise<NotificationPermission> | null = null;
/** Strong refs so pending notifications aren't GC'd before click (parity with main). */
const activeNotifications = new Set<Notification>();

/** True when the browser exposes the Notification API (jsdom-safe guard). */
function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && typeof Notification !== 'undefined';
}

/**
 * Resolve notification permission, requesting it lazily on 'default'.
 * Concurrent callers share one in-flight `requestPermission()` prompt.
 * REJECTS when the browser's request itself throws — callers decide whether
 * to fold that to a silent skip (idle path) or a shaped error (settings
 * bridge).
 */
async function resolvePermission(): Promise<NotificationPermission> {
  let permission = Notification.permission;
  if (permission === 'default') {
    if (!pendingPermissionRequest) {
      pendingPermissionRequest = Promise.resolve(Notification.requestPermission()).finally(() => {
        pendingPermissionRequest = null;
      });
    }
    permission = await pendingPermissionRequest;
  }
  return permission;
}

/**
 * Resolve notification permission for the notification path. Returns true
 * only when granted. Never rejects; 'denied' and request failures fold to
 * false (logged once).
 */
async function ensurePermission(): Promise<boolean> {
  if (!isNotificationSupported()) {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.warn('Browser Notification API is not available; skipping web notifications');
    }
    return false;
  }
  let permission: NotificationPermission;
  try {
    permission = await resolvePermission();
  } catch (error) {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.warn('Notification permission request failed', { error });
    }
    return false;
  }
  if (permission !== 'granted') {
    if (!loggedPermissionSkip) {
      loggedPermissionSkip = true;
      logger.info('Notification permission not granted; web notifications disabled', {
        permission,
      });
    }
    return false;
  }
  return true;
}

/** Daemon setting paths consulted per idle event (PROTOCOL §5.12). */
const SETTING_PATH_ENABLED = 'notifications.enabled';
const SETTING_PATH_SOUND_ONLY_WHEN_UNFOCUSED = 'notifications.soundOnlyWhenUnfocused';

/** Notification preferences consulted per idle event. */
interface NotificationPrefs {
  enabled: boolean;
  soundOnlyWhenUnfocused: boolean;
}

/**
 * Fetch fresh `notifications.*` preferences from the daemon — parity with the
 * main-process service's per-event `refreshPrefs()` (settings toggles take
 * effect without a reload, and a not-yet-hydrated store can't leak a stale
 * value). Falls back to the Redux store's values (kept in sync by the
 * user-preferences-notification-persistence middleware) when the daemon read
 * fails.
 */
async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const state = appStore.state as StoreState;
  const fallback: NotificationPrefs = {
    enabled: state.userPreferences.enabled ?? true,
    soundOnlyWhenUnfocused: state.userPreferences.soundOnlyWhenUnfocused ?? true,
  };
  try {
    const [enabled, soundOnlyWhenUnfocused] = await Promise.all([
      backendRequest('settings.get', { path: SETTING_PATH_ENABLED }),
      backendRequest('settings.get', { path: SETTING_PATH_SOUND_ONLY_WHEN_UNFOCUSED }),
    ]);
    const enabledValue = (enabled as { value?: unknown } | null)?.value;
    const soundValue = (soundOnlyWhenUnfocused as { value?: unknown } | null)?.value;
    return {
      enabled: typeof enabledValue === 'boolean' ? enabledValue : fallback.enabled,
      soundOnlyWhenUnfocused:
        typeof soundValue === 'boolean' ? soundValue : fallback.soundOnlyWhenUnfocused,
    };
  } catch (error) {
    logger.warn('Failed to fetch notifications.* settings from daemon', { error });
    return fallback;
  }
}

/** `agent.list` response subset consulted for suppression (PROTOCOL §5.5). */
interface AgentListResult {
  agents?: Array<{
    id?: string;
    isStreaming?: boolean;
    isResponding?: boolean;
    metadata?: { isBackground?: boolean; specialist?: string };
  }>;
}

/** Fetch the workspace title for notification context; absence is fine. */
async function fetchWorkspaceTitle(workspaceId: string): Promise<string | undefined> {
  try {
    const response = (await backendRequest('workspace.get', { workspaceId })) as
      | { workspace?: { title?: string } }
      | undefined;
    const title = response?.workspace?.title;
    return typeof title === 'string' && title.length > 0 ? title : undefined;
  } catch {
    // Ignore - use default without workspace title (parity with main).
    return undefined;
  }
}

/**
 * Show a browser notification; clicking focuses the tab and routes via the
 * shared navigate handler (chief payload parity with main's click sender).
 */
async function showWebNotification(
  content: NotificationContent,
  workspaceId?: string,
  agentId?: string,
): Promise<void> {
  // Sound first, mirroring Electron where `notification:show` (the renderer
  // sound gate) fires regardless of banner permission/support.
  void playNotificationSoundPerSettings();

  const granted = await ensurePermission();
  if (!granted) return;

  try {
    const notification = new Notification(content.title, { body: content.body });
    activeNotifications.add(notification);
    notification.onclick = () => {
      activeNotifications.delete(notification);
      try {
        window.focus();
      } catch {
        // window.focus() can throw in exotic embeddings; navigation still runs.
      }
      if (workspaceId) {
        const payload =
          workspaceId === CHIEF_WORKSPACE_ID
            ? { workspaceId, chief: true, ...(agentId ? { agentId } : {}) }
            : { workspaceId };
        void handleNotificationNavigate(payload);
      }
      notification.close();
    };
    notification.onclose = () => {
      activeNotifications.delete(notification);
    };
    notification.onerror = () => {
      activeNotifications.delete(notification);
      logger.warn('Web notification failed to show', { title: content.title });
    };
  } catch (error) {
    logger.warn('Failed to show web notification', { error });
  }
}

/**
 * Handle a relayed `agent:idle` event — a port of the main-process
 * `NotificationService.handleAgentIdle` decision logic.
 */
export async function handleWebAgentIdle(event: AgentIdleEvent): Promise<void> {
  try {
    const workspaceId = event.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) return;

    // Fresh read so settings toggles take effect without a reload and a
    // not-yet-hydrated store can't leak a stale value (main-process
    // refreshPrefs parity); folds back to the store on daemon failure.
    const { enabled, soundOnlyWhenUnfocused } = await fetchNotificationPrefs();

    if (!enabled) {
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

    // `agent.list` (PROTOCOL §5.5) serves two purposes: AgentLite `metadata`
    // carries `isBackground`/`specialist` (absent from the daemon idle
    // payload), and `isStreaming`/`isResponding` feed the other-agents-active
    // suppression gate below (parity with main/notification.service.ts).
    const agentList = (await backendRequest('agent.list', { workspaceId })) as
      | AgentListResult
      | undefined;
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

    const isChief = workspaceId === CHIEF_WORKSPACE_ID;
    const workspaceTitle = isChief ? undefined : await fetchWorkspaceTitle(workspaceId);
    const content = buildNotificationContent(
      {
        isChief,
        agentName: event.data.agentName,
        specialist: event.data.specialist ?? idleAgent?.metadata?.specialist,
        taskTitle: event.data.taskTitle,
      },
      workspaceTitle,
    );

    // Focus gate for the banner: `soundOnlyWhenUnfocused` ON suppresses the
    // banner only while the (single) tab is focused AND viewing the event's
    // own workspace; OFF shows it even when focused. The sound gate ALWAYS
    // runs regardless of focus (Electron parity: `notification:show` is
    // always sent). Electron's per-window focus check collapses to
    // `document.hasFocus()` + the active workspace id on the single web tab.
    const activeWorkspaceId =
      (appStore.state as { workspace?: { activeWorkspaceId?: string | null } }).workspace
        ?.activeWorkspaceId ?? null;
    const focusedViewingWorkspace =
      typeof document !== 'undefined' && document.hasFocus() && activeWorkspaceId === workspaceId;
    if (focusedViewingWorkspace && soundOnlyWhenUnfocused) {
      logger.debug('Focused tab is viewing the workspace, suppressing banner', {
        workspaceId,
        agentName: event.data.agentName,
      });
      // Structural parity with Electron's always-sent `notification:show`:
      // on the single web tab this call is effectively a no-op (the gate's
      // soundOnlyWhenUnfocused + hasFocus() decline matches this branch's
      // condition), but keeping it means the sound gate remains the single
      // decision point if the suppression condition ever diverges.
      void playNotificationSoundPerSettings();
      return;
    }

    await showWebNotification(content, workspaceId, event.data.agentId);
  } catch (error) {
    logger.error('Failed to handle agent:idle event', error);
  }
}

/**
 * Show a test notification (settings-page test button via the
 * `notification:test` bridge). Mirrors the main-process
 * `showTestNotification` payload and `{ success, error? }` envelope.
 */
export async function showTestWebNotification(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isNotificationSupported()) {
      return {
        success: false,
        error: m.notification_not_supported(),
      };
    }
    const granted = await ensurePermission();
    if (!granted) {
      return { success: false, error: m.notifications_web_permissionNotGranted_error() };
    }
    await showWebNotification({
      title: m.notification_specialist_agent(),
      body: m.notification_test_body(),
    });
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : m.notifications_web_unknown_error();
    logger.error('Failed to show test notification', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Request browser notification permission (settings-page flow via the
 * `notification:requestPermission` bridge). Envelope parity with the Electron
 * handler: `{ success: true, granted }` / `{ success: false, error }`.
 */
export async function requestWebNotificationPermission(): Promise<{
  success: boolean;
  granted?: boolean;
  error?: string;
}> {
  try {
    if (!isNotificationSupported()) {
      return {
        success: false,
        error: m.notification_not_supported(),
      };
    }
    // resolvePermission (not ensurePermission): a thrown requestPermission
    // must surface as the { success: false, error } arm here — the settings
    // flow reports real failures instead of folding them to granted: false.
    const permission = await resolvePermission();
    return { success: true, granted: permission === 'granted' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : m.notifications_web_unknown_error(),
    };
  }
}

/**
 * Middleware activating the web notification service. Registers ONE listener
 * on the relayed legacy `agent:idle` channel when the platform is web;
 * registers nothing on Electron (native pipeline unchanged). The listener
 * persists for the renderer lifetime (zoom-sync/notification-ipc idiom).
 */
export function createWebNotificationMiddleware(): StoreMiddleware {
  return () => {
    if (!installed && getPlatform() === 'web') {
      installed = true;
      addMockIpcListener('agent:idle', (payload) => {
        const event = payload as AgentIdleEvent | undefined;
        if (!event || event.type !== 'agent:idle' || !event.data) return;
        void handleWebAgentIdle(event);
      });
    }
    return (next) => (action) => next(action);
  };
}

/** Test-only: reset module state between tests. @internal */
export function __resetWebNotificationServiceForTesting(): void {
  installed = false;
  loggedPermissionSkip = false;
  pendingPermissionRequest = null;
  activeNotifications.clear();
}

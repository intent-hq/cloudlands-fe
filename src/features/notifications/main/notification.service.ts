/**
 * Notification Service
 *
 * Main process service that shows desktop notifications when agents complete.
 * Holds one long-lived daemon `events.subscribe` subscription for `agent:idle`
 * events (PROTOCOL.md §6.1–§6.3) PER connected backend (the local sidecar AND
 * every remote intentd connection), each with `workspaceId` omitted so events
 * are delivered across ALL of that backend's workspaces. Native OS
 * notifications are routed per-event by `event.workspaceId`, and follow-up
 * RPCs (`agent.get` / `agent.listActive`, workspace title) go to the EMITTING
 * backend's client.
 *
 * Persisted notification preferences live on the daemon under `notifications.*`
 * (PROTOCOL.md §5.12); the legacy `notificationSettings` electron-store bag is
 * retired. Preference reads stay pinned to the LOCAL daemon — they are an
 * app-level preference of the machine the user is sitting at, matching the
 * app-settings service convention — and gate notifications from every backend.
 * Preferences are re-fetched on each idle event so settings toggles take
 * effect without a relaunch; the last-known values are kept as a fallback
 * when the daemon is unreachable.
 */

import { app, BrowserWindow, Notification, screen } from 'electron';
import { claimActivationFocus } from '../../../main/activation-focus-claim';
import { isHudWindow } from '../../../main/hud-window';
import { getBackendIdForWindow } from '../../../main/window-backend';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID, WorkspaceId } from '../../../shared/types/branded-ids';
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';
import type { AgentIdleEvent } from '../../events/types';
import type { JsonRpcClient, JsonRpcNotification } from '../../backend/main/json-rpc-client';
import { readIdleNotificationGate } from '../utils/idle-gate';
import {
  BACKEND_CLIENT_DISCONNECTED_EVENT,
  getBackendClient,
  getBackendClientForConnection,
  getLiveBackendIds,
  onAnyBackendNotification,
  onAnyBackendReconnected,
  onAnyBackendStatus,
} from '../../backend/main/backend.ipc';
import {
  getFocusedWindowWorkspaceId,
  getViewedWorkspaceIdForWindow,
  getWindowIdsForWorkspace,
  sendToWorkspaceWindows,
} from '../../system/main/system.ipc';
import { ANY_HOST, type WindowHostScope } from '../../system/main/window-workspace-tracking';

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
  // Deliberately LOCAL-pinned: `notifications.*` is an app-level preference of
  // the machine the user is sitting at (same convention as app-settings), so
  // it gates idle events from every backend, local and remote alike.
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
 * Map specialist ID to localized display name (message functions so the
 * active main-process locale is applied at notification time)
 */
const SPECIALIST_DISPLAY_NAMES: Record<string, () => string> = {
  'spec-writer': () => m.notification_specialist_coordinator(),
  implementor: () => m.notification_specialist_implementor(),
  verifier: () => m.notification_specialist_verifier(),
};

/**
 * Get display name for a specialist type
 */
function getSpecialistDisplayName(specialist?: string): string {
  if (!specialist) return m.notification_specialist_agent();
  return SPECIALIST_DISPLAY_NAMES[specialist]?.() || m.notification_specialist_agent();
}

/**
 * Structured content parts carried on `notification:show` alongside the
 * concatenated `title`/`body`, so the renderer toast can lay them out on
 * separate lines. Present only for non-chief agent-idle notifications.
 */
interface NotificationStructuredContent {
  /** Untruncated workspace title (the renderer truncates via CSS). */
  workspaceTitle?: string;
  /** Raw specialist id, e.g. "spec-writer". */
  specialist?: string;
  /** Localized specialist display name, e.g. "Coordinator". */
  specialistDisplayName: string;
  taskTitle?: string;
  /** ACP provider id (auggie, claude-code, codex, ...). */
  provider?: string;
  /** Idle agent's id — seeds AgentAvatar's deterministic gradient colors. */
  agentId?: string;
  /** Idle agent's display name — names who finished in the in-app toast. */
  agentName?: string;
}

/**
 * Notification content for display
 */
interface NotificationContent {
  title: string;
  body: string;
  structured?: NotificationStructuredContent;
}

/**
 * Pick the window a notification click should focus/navigate. Resolved at
 * CLICK time — a banner can sit in Notification Center while the user moves
 * the workspace between windows — in this order:
 *   1. a window actively viewing the workspace,
 *   2. a window holding the workspace in a background tab,
 *   3. the focused window,
 *   4. any window.
 * When `backendId` is given, only windows bound to that daemon connection
 * (`getBackendIdForWindow`) qualify at every tier: a window on another host
 * must never be asked to open the workspace, and workspace ids are not unique
 * across hosts (the Assistant's virtual workspace id is the same constant on
 * every daemon), so the workspace lookup itself is scoped to that host.
 * Without `backendId` (test notifications) any window qualifies. The HUD pop-out is never a target (shared `isHudWindow`
 * helper). Returns undefined when no window qualifies.
 */
function pickNotificationClickTarget(
  workspaceId: string | undefined,
  backendId: string | undefined,
): BrowserWindow | undefined {
  const usable = (w: BrowserWindow): boolean =>
    !w.isDestroyed() &&
    !isHudWindow(w) &&
    (backendId === undefined || getBackendIdForWindow(w) === backendId);

  if (workspaceId) {
    const workspaceWindows = getWindowIdsForWorkspace(workspaceId, backendId ?? ANY_HOST)
      .map((id) => BrowserWindow.fromId(id))
      .filter((w): w is BrowserWindow => w !== null && usable(w));
    const viewing = workspaceWindows.find(
      (w) => getViewedWorkspaceIdForWindow(w.id) === workspaceId,
    );
    const holding = viewing ?? workspaceWindows[0];
    if (holding) return holding;
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && usable(focused)) return focused;
  return BrowserWindow.getAllWindows().find(usable);
}

/**
 * Bring Intent to the front on macOS once the click target is known. A plain
 * window focus() from an inactive app may not activate it under macOS
 * cooperative activation. Called only AFTER the target window exists:
 * activating earlier raises the last key window, which may be on the wrong
 * host, while a new window is still being created.
 */
function activateAppOnMac(): void {
  if (process.platform !== 'darwin') return;
  app.show();
  app.focus({ steal: true });
}

/**
 * Click-navigation target attached to `notification:show` when the OS banner
 * was skipped because the app was frontmost (electron#51885). The renderer
 * shows a clickable in-app toast that routes through the same navigation as
 * `notification:navigate`.
 */
interface NotificationNavigateTarget {
  workspaceId: string;
  chief?: boolean;
  agentId?: string;
}

/**
 * Per-backend subscription state. One entry per live pooled backend client,
 * keyed by backend id in {@link NotificationService.backendStates}.
 */
interface BackendSubscriptionState {
  /** Live daemon-side subscription id, once `events.subscribe` resolved. */
  subscriptionId?: string;
  /** Guards against stale in-flight subscribes (bumped on stop/reconnect/disposal). */
  epoch: number;
  /**
   * Set when this backend's subscribe failed (initial-connect gap): the next
   * `connected` status transition for this backend re-issues the subscribe.
   */
  retryArmed: boolean;
}

export class NotificationService {
  private started = false;
  /** Per-backend `agent:idle` subscription state, keyed by backend id. */
  private backendStates = new Map<string, BackendSubscriptionState>();
  /** Disposer for the stable-forwarder notification listener, once attached. */
  private notificationDisposer?: () => void;
  private reconnectDisposer?: () => void;
  /** Disposer for the any-backend `status` listener (late connects + retry). */
  private statusDisposer?: () => void;
  /** Detaches the pooled-client disposal listener on the Electron app emitter. */
  private clientDisconnectedListener?: (instance: JsonRpcClient) => void;
  private activeNotifications = new Set<Notification>();
  /**
   * Latest notification per stable id. When a same-id notification replaces a
   * delivered one, the OS may never emit `close` for the replaced instance —
   * this map lets us evict it from `activeNotifications` so the set cannot
   * grow over repeated idles from the same agent.
   */
  private notificationsById = new Map<string, Notification>();

  constructor() {
    // Warm the preferences cache eagerly; each `handleAgentIdle` re-fetches.
    void refreshPrefs();
  }

  /**
   * Start the notification service: attach one long-lived daemon `agent:idle`
   * subscription PER live backend, covering all workspaces (PROTOCOL.md §6.1,
   * `workspaceId` omitted), subscribe late-connecting backends as they appear,
   * and re-issue each backend's subscription on its reconnect (RESUB-1).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    logger.info('NotificationService started');
    void this.attachIdleSubscriptions();
  }

  /**
   * Stop the notification service: detach the forwarder listeners and
   * best-effort unsubscribe every backend's `agent:idle` subscription.
   */
  stop(): void {
    this.started = false;
    this.reconnectDisposer?.();
    this.reconnectDisposer = undefined;
    this.statusDisposer?.();
    this.statusDisposer = undefined;
    this.notificationDisposer?.();
    this.notificationDisposer = undefined;
    if (this.clientDisconnectedListener) {
      (app as NodeJS.EventEmitter).off(
        BACKEND_CLIENT_DISCONNECTED_EVENT,
        this.clientDisconnectedListener,
      );
      this.clientDisconnectedListener = undefined;
    }
    for (const [backendId, state] of this.backendStates) {
      // Invalidate any in-flight subscribe so it can't resurrect a stale id.
      state.epoch++;
      const { subscriptionId } = state;
      state.subscriptionId = undefined;
      if (subscriptionId) this.releaseSubscription(backendId, subscriptionId);
    }
    this.backendStates.clear();
    logger.info('NotificationService stopped');
  }

  /**
   * Attach the per-backend daemon notification/reconnect/status listeners and
   * issue the initial `events.subscribe` for every live pooled backend.
   * Mirrors the terminal-registry / script-manager long-lived subscription
   * pattern: the listeners persist across reconnects AND client swaps (stable
   * forwarders); only the per-backend subscription ids are re-issued.
   *
   * All listeners are attached synchronously (before the first `await`), so a
   * later `stop()` always observes and detaches them — it can never
   * interleave with a half-attached state.
   */
  private async attachIdleSubscriptions(): Promise<void> {
    try {
      const listener = (backendId: string, n: JsonRpcNotification): void => {
        if (n.method !== 'events.event') return;
        const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
        const subId =
          typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
        // Strict match against the EMITTING backend's own subscription id:
        // the pooled clients also carry notifications for renderer-proxied
        // subscriptions; only our own subscriptions' events may trigger a
        // desktop notification.
        const state = this.backendStates.get(backendId);
        if (!state?.subscriptionId || subId !== state.subscriptionId) return;
        const event = params?.event as { type?: unknown; workspaceId?: unknown } | undefined;
        if (!event || event.type !== 'agent:idle') return;
        // Per-event routing (suppression, prefs, focus gating, sound/click
        // delivery) keys off the event's workspaceId; an event without one
        // cannot be routed.
        if (typeof event.workspaceId !== 'string') return;
        void this.handleAgentIdle(event as unknown as AgentIdleEvent, backendId);
      };
      this.notificationDisposer = onAnyBackendNotification(listener);
      this.reconnectDisposer = onAnyBackendReconnected((backendId) => {
        if (!this.started) return;
        const state = this.backendStates.get(backendId);
        if (!state) {
          // A backend we never managed to track (e.g. `connections:add`
          // replays `reconnected` for a freshly pooled client) — treat as a
          // late connect.
          void this.ensureBackendSubscribed(backendId);
          return;
        }
        // The daemon dropped every in-memory subscription on reconnect; the
        // stale id belonged to the previous connection. Invalidate any
        // in-flight subscribe from before the reconnect and re-issue.
        state.epoch++;
        state.subscriptionId = undefined;
        void this.subscribeBackend(backendId, state);
      });
      // Any-backend status listener, doing double duty: a first `connected`
      // transition from an untracked id is the "new backend appeared" signal
      // (subscribe it), and a `connected` transition on a tracked backend
      // whose subscribe failed re-issues it (initial-connect gap — RESUB-1
      // covers reconnects only: when the subscribe ran before that backend's
      // FIRST successful connect, `reconnected` never fires).
      this.statusDisposer = onAnyBackendStatus((backendId, status) => {
        if (!this.started || status !== 'connected') return;
        const state = this.backendStates.get(backendId);
        if (!state) {
          void this.ensureBackendSubscribed(backendId);
          return;
        }
        if (!state.retryArmed) return;
        state.retryArmed = false;
        // Guard against double-subscribe: the reconnect handler (or a late
        // in-flight subscribe) may have already produced a live id.
        if (state.subscriptionId) return;
        void this.subscribeBackend(backendId, state);
      });
      // Drop per-backend state when a pooled client is disposed
      // (`disconnectBackendClient`). The event payload is the client
      // instance, not its id; the client was already removed from the pool
      // before the emit, so every tracked id without a live pooled client is
      // the disposed one. No daemon-side unsubscribe: the connection is gone.
      this.clientDisconnectedListener = (): void => {
        for (const [backendId, state] of this.backendStates) {
          if (getBackendClientForConnection(backendId)) continue;
          state.epoch++;
          state.subscriptionId = undefined;
          this.backendStates.delete(backendId);
          logger.debug('Dropped agent:idle subscription state for disposed backend', {
            backendId,
          });
        }
      };
      (app as NodeJS.EventEmitter).on(
        BACKEND_CLIENT_DISCONNECTED_EVENT,
        this.clientDisconnectedListener,
      );
      // Seed: subscribe every backend already pooled when the service starts
      // (always includes the local sidecar). Per-backend fail-soft — one dead
      // remote must not break the others.
      await Promise.all(
        getLiveBackendIds().map((backendId) => this.ensureBackendSubscribed(backendId)),
      );
    } catch (error) {
      logger.warn('Failed to attach agent:idle subscriptions', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Track a backend and issue its `agent:idle` subscribe if none is live. */
  private async ensureBackendSubscribed(backendId: string): Promise<void> {
    if (!this.started) return;
    let state = this.backendStates.get(backendId);
    if (!state) {
      state = { epoch: 0, retryArmed: false };
      this.backendStates.set(backendId, state);
    }
    if (state.subscriptionId) return;
    await this.subscribeBackend(backendId, state);
  }

  /**
   * Issue `events.subscribe` for `agent:idle` across ALL of one backend's
   * workspaces — `workspaceId` is deliberately omitted (§6.1) so completions
   * in workspaces without an open window/tab still notify.
   */
  private async subscribeBackend(
    backendId: string,
    state: BackendSubscriptionState,
  ): Promise<void> {
    const epoch = state.epoch;
    try {
      const client = this.clientFor(backendId);
      if (!client) return;
      const result = (await client.request('events.subscribe', {
        eventTypes: ['agent:idle'],
      })) as { subscriptionId?: string } | undefined;
      const subscriptionId = result?.subscriptionId;
      if (epoch !== state.epoch || !this.started || this.backendStates.get(backendId) !== state) {
        // stop(), a reconnect, or a disposal ran while subscribe was in
        // flight; this id belongs to a torn-down generation. Best-effort
        // release it instead of overwriting the current one.
        if (subscriptionId) this.releaseSubscription(backendId, subscriptionId);
        return;
      }
      // Concurrent same-epoch subscribes (reconnect handler racing an armed
      // status-retry) can both land here; release the superseded id so it
      // doesn't leak daemon-side for the connection lifetime.
      const previousId = state.subscriptionId;
      state.subscriptionId = subscriptionId;
      if (previousId && previousId !== subscriptionId) {
        this.releaseSubscription(backendId, previousId);
      }
      state.retryArmed = false;
    } catch (error) {
      logger.warn(
        'events.subscribe for agent:idle failed; will retry on the next connected transition',
        {
          backendId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // Arm the retry: the any-backend status listener re-issues this
      // backend's subscribe on its next `connected` transition.
      if (epoch === state.epoch && this.started && this.backendStates.get(backendId) === state) {
        state.retryArmed = true;
      }
    }
  }

  /**
   * Resolve a backend id to its live pooled client. The local id falls back
   * to the lazily-created shared client (startup boot order); a missing
   * remote resolves to undefined — fail-soft, never retarget another backend.
   */
  private clientFor(backendId: string): JsonRpcClient | undefined {
    const client = getBackendClientForConnection(backendId);
    if (client) return client;
    if (backendId === LOCAL_CONNECTION_ID) return getBackendClient();
    return undefined;
  }

  /** Best-effort daemon-side release of a subscription id on one backend. */
  private releaseSubscription(backendId: string, subscriptionId: string): void {
    try {
      const client = this.clientFor(backendId);
      if (!client) return;
      void client.request('events.unsubscribe', { subscriptionId }).catch((error: unknown) => {
        logger.debug('Failed to tear down agent:idle subscription', {
          backendId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } catch (error) {
      logger.debug('Failed to tear down agent:idle subscription', {
        backendId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle an agent:idle event delivered by a per-backend daemon
   * subscription. All per-workspace behavior (suppression, focus gating,
   * sound and click routing) keys off `event.workspaceId`; follow-up RPCs
   * (`agent.get` / `agent.listActive`, workspace title) go to the EMITTING
   * backend's client (`backendId`, defaulting to local for direct
   * callers/tests).
   */
  async handleAgentIdle(
    event: AgentIdleEvent,
    backendId: string = LOCAL_CONNECTION_ID,
  ): Promise<void> {
    try {
      const workspaceId = event.workspaceId;
      const client = this.clientFor(backendId);
      if (!client) {
        logger.debug('Dropping agent:idle event from disposed backend', { backendId, workspaceId });
        return;
      }
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

      // Fast path: per-agent mute stamped on the payload (§5.5
      // `notificationsMuted`, present only when true). Absent on older
      // daemons, in which case the agent.get gate below still applies.
      if (event.data.notificationsMuted === true) {
        logger.debug('Skipping notification for muted agent', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Fast path: the event's workspace is archived — archived workspaces
      // never notify. Absent on older daemons (treated as not archived).
      if (event.data.workspaceArchived === true) {
        logger.debug('Skipping notification for archived workspace', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Fast path: the agent ended its turn while awaiting delegated
      // sub-agents (pending completion watches) — the workspace isn't truly
      // quiet even if the children haven't started responding yet. Absent on
      // older daemons, in which case the agent.listActive gate below still
      // applies.
      if (event.data.isWaitingForOtherAgents === true) {
        logger.debug('Skipping notification for agent waiting on other agents', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Fast path: the agent went idle while it still owns active
      // background hooks (PROTOCOL §3.1) or active PR monitors (§5.42) — it
      // will run again when a hook dispatches/expires or a monitor
      // condition fires, so the workspace isn't truly quiet yet. Absent on
      // older daemons.
      if ((event.data.waitingOnHooks?.length ?? 0) > 0) {
        logger.debug('Skipping notification for agent waiting on hooks', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }
      if (
        (event.data.waitingOnPrMonitors?.length ?? 0) > 0 ||
        (event.data.waitingOnScriptMonitors?.length ?? 0) > 0
      ) {
        logger.debug('Skipping notification for agent waiting on monitors', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Bounded wire gate (utils/idle-gate.ts, intent#5531 — never the
      // unscoped `agent.list`): `agent.get` for the idle agent's own
      // `metadata` (`isBackground`/`specialist`, absent from the daemon idle
      // payload) / `notificationsMuted` / `provider`, then `agent.listActive`
      // + per-active-sibling `agent.get` for the other-agents-active
      // suppression. Routed to the EMITTING backend — the workspace only
      // exists there.
      const verdict = await readIdleNotificationGate(
        (method, params) => client.request(method, params),
        { workspaceId, agentId: event.data.agentId },
      );
      const idleAgent = verdict.idleAgent;

      // Skip background agents — delegated child completions stay quiet.
      if (verdict.kind === 'background') {
        logger.debug('Skipping notification for background agent (metadata)', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      // Skip muted agents (AgentLite top-level `notificationsMuted`) —
      // parity with the payload fast path for idle events that predate the
      // stamp.
      if (verdict.kind === 'muted') {
        logger.debug('Skipping notification for muted agent (agent.get)', {
          workspaceId,
          agentName: event.data.agentName,
        });
        return;
      }

      if (verdict.kind === 'others-active') {
        logger.debug('Other agents still active, skipping notification', {
          workspaceId,
          agentName: event.data.agentName,
          otherActiveCount: verdict.otherActiveCount,
        });
        return;
      }

      // Build notification content with specialist type and task title;
      // enrich with `metadata.specialist` when the payload lacks it. The
      // provider (AgentLite top-level field, PROTOCOL.md §5.5) feeds the
      // structured toast parts.
      const content = await this.buildNotificationContent(
        {
          ...event,
          data: {
            ...event.data,
            specialist: event.data.specialist ?? idleAgent?.metadata?.specialist,
          },
        } as AgentIdleEvent,
        idleAgent?.provider,
        backendId,
      );

      // Focus gate for the OS banner: `soundOnlyWhenUnfocused` ON suppresses
      // the banner only while the focused window is VIEWING the event's own
      // workspace; OFF shows it even when focused. The `notification:show`
      // renderer event is ALWAYS sent regardless of focus so the renderer
      // sound gate decides on its own.
      // The focused window must be on the emitting host: workspace ids are
      // only unique per host (the Assistant id is shared), so a local window
      // viewing the local Assistant is not viewing a remote one.
      const focusedWindow = BrowserWindow.getFocusedWindow();
      const focusedViewingWorkspace =
        focusedWindow !== null &&
        getBackendIdForWindow(focusedWindow) === backendId &&
        getFocusedWindowWorkspaceId() === workspaceId;
      if (focusedViewingWorkspace && prefs.soundOnlyWhenUnfocused) {
        logger.debug('Focused window is viewing the workspace, suppressing OS banner', {
          workspaceId,
          agentName: event.data.agentName,
        });
        this.sendShowEvent(content, backendId, workspaceId);
        return;
      }

      // Frontmost gate: under Electron 42's UNUserNotificationCenter backend,
      // `click` never fires for banners presented while the app is frontmost
      // on macOS (electron#51885). Skip the OS banner and deliver an in-app
      // clickable toast instead — `navigateTarget` mirrors the banner
      // click-payload so the renderer routes the same way. A focused HUD
      // pop-out does NOT count as frontmost: the HUD renders no toast UI and
      // is never a notification target, so HUD-focused delivery stays on the
      // OS-banner path (whose click goes through the HUD-excluding picker).
      // The focused window must also be on the emitting host: a toast is only
      // useful in the window the user is looking at, and a window on another
      // host cannot open this workspace. Otherwise the OS banner is shown
      // (visible even if, on macOS while frontmost, its click may not fire).
      const appFrontmostOnHost =
        focusedWindow !== null &&
        !isHudWindow(focusedWindow) &&
        getBackendIdForWindow(focusedWindow) === backendId;
      if (appFrontmostOnHost) {
        logger.debug('App is frontmost, delivering in-app toast instead of OS banner', {
          workspaceId,
          agentName: event.data.agentName,
        });
        const navigateTarget: NotificationNavigateTarget =
          workspaceId === CHIEF_WORKSPACE_ID
            ? {
                workspaceId,
                chief: true,
                ...(event.data.agentId ? { agentId: event.data.agentId } : {}),
              }
            : { workspaceId };
        this.sendShowEvent(content, backendId, workspaceId, navigateTarget);
        return;
      }

      // Show the OS banner. The click target is resolved when the user
      // clicks (see pickNotificationClickTarget), scoped to the emitting
      // backend so remote-host workspaces open in a window on that host.
      this.showNotification(content, workspaceId, event.data.agentId, backendId);
    } catch (error) {
      logger.error('Failed to handle agent:idle event', error as Error);
    }
  }

  /**
   * Build notification content from event data
   * Uses specialist display name and task title instead of agent name.
   * Non-chief notifications additionally carry `structured` content parts
   * (untruncated, for the renderer's multi-line toast layout); chief
   * notifications keep the plain title/body only.
   */
  private async buildNotificationContent(
    event: AgentIdleEvent,
    provider?: string,
    backendId: string = LOCAL_CONNECTION_ID,
  ): Promise<NotificationContent> {
    const { specialist, taskTitle } = event.data;

    // Chief-of-staff completions: the chief "workspace" is a hidden virtual
    // workspace, so title with the chat thread name instead of
    // "<workspaceTitle> - <specialist>".
    if (event.workspaceId === CHIEF_WORKSPACE_ID) {
      const chatName = event.data.agentName;
      const truncatedChatName =
        chatName && chatName.length > 40 ? `${chatName.slice(0, 37)}...` : chatName;
      return {
        title: truncatedChatName
          ? m.notification_assistant_titled({ chatName: truncatedChatName })
          : m.notification_assistant_title(),
        body: taskTitle ? m.notification_body_task_completed() : m.notification_body_finished(),
      };
    }

    // Get display name for the agent type
    const displayName = getSpecialistDisplayName(specialist);

    // Get workspace title for context. Local events keep the workspaceService
    // path (validation + chief synthesis); remote-backend workspaces only
    // exist on the emitting daemon, so fetch `workspace.get` (PROTOCOL.md
    // §5.1) over that backend's client directly.
    let workspaceTitle: string | undefined;
    try {
      if (backendId === LOCAL_CONNECTION_ID) {
        const { workspaceService } = await import('../../workspace/main/workspace.service');
        const workspaceResult = await workspaceService.getWorkspace(WorkspaceId(event.workspaceId));
        if (workspaceResult.ok && workspaceResult.data?.title) {
          workspaceTitle = workspaceResult.data.title;
        }
      } else {
        const client = this.clientFor(backendId);
        const response = (await client?.request('workspace.get', {
          workspaceId: event.workspaceId,
        })) as { workspace?: { title?: unknown } } | { title?: unknown } | undefined;
        const raw =
          response && typeof response === 'object' && 'workspace' in response
            ? (response as { workspace?: { title?: unknown } }).workspace
            : response;
        if (raw && typeof (raw as { title?: unknown }).title === 'string') {
          workspaceTitle = (raw as { title: string }).title;
        }
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
    const body = taskTitle ? m.notification_body_task_completed() : m.notification_body_finished();

    return {
      title,
      body,
      structured: {
        ...(workspaceTitle ? { workspaceTitle } : {}),
        ...(specialist ? { specialist } : {}),
        specialistDisplayName: displayName,
        ...(taskTitle ? { taskTitle } : {}),
        ...(provider ? { provider } : {}),
        ...(event.data.agentId ? { agentId: event.data.agentId } : {}),
        ...(event.data.agentName ? { agentName: event.data.agentName } : {}),
      },
    };
  }

  /**
   * Send the `notification:show` renderer event so the renderer can play the
   * notification sound. Sent regardless of window focus or banner suppression.
   * `scope` is the emitting host (or `ANY_HOST` for test notifications).
   * Delivered to that host's windows with the event's workspace open; when
   * none exist it falls back to the focused (or any) non-HUD window on that
   * host. `navigateTarget` is present only when the OS banner was skipped
   * because the app was frontmost (electron#51885) — the renderer then shows
   * a clickable in-app toast. When no window is connected to the emitting
   * host at all, the sound still plays on the focused (or any) window but
   * WITHOUT `navigateTarget`: a click there would navigate a window on
   * another host, which cannot show this workspace.
   */
  private sendShowEvent(
    content: NotificationContent,
    scope: WindowHostScope,
    workspaceId?: string,
    navigateTarget?: NotificationNavigateTarget,
  ): void {
    const payload = {
      title: content.title,
      body: content.body,
      timestamp: new Date().toISOString(),
      ...(content.structured ? { structured: content.structured } : {}),
      ...(navigateTarget ? { navigateTarget } : {}),
    };
    if (workspaceId && getWindowIdsForWorkspace(workspaceId, scope).length > 0) {
      sendToWorkspaceWindows(workspaceId, 'notification:show', payload, scope);
      return;
    }
    const send = (window: BrowserWindow | null | undefined, data: unknown): void => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('notification:show', data);
      }
    };
    const onHost = (w: BrowserWindow): boolean =>
      !w.isDestroyed() &&
      !isHudWindow(w) &&
      (scope === ANY_HOST || getBackendIdForWindow(w) === scope);
    const focused = BrowserWindow.getFocusedWindow();
    const hostWindow =
      focused && onHost(focused) ? focused : BrowserWindow.getAllWindows().find(onHost);
    if (hostWindow) {
      send(hostWindow, payload);
      return;
    }
    // No window is connected to the emitting host: keep the sound, drop the
    // click target (see the doc comment).
    const { navigateTarget: _dropped, ...soundOnly } = payload;
    const usable = (w: BrowserWindow): boolean => !w.isDestroyed() && !isHudWindow(w);
    send(
      focused && usable(focused) ? focused : BrowserWindow.getAllWindows().find(usable),
      soundOnly,
    );
  }

  /**
   * Show a desktop notification
   *
   * Agent-idle notifications carry a stable `id` of `workspaceId:agentId`
   * (macOS `UNNotificationRequest.identifier`) so a repeat idle from the same
   * agent natively REPLACES the delivered notification — at most one per
   * agent at any time. Test notifications omit `id` (Electron falls back to
   * a random UUID) so they never replace or get replaced.
   *
   * The backend id is deliberately NOT folded into the stable id: workspace
   * ids are daemon-generated UUIDs, so two backends only share one when they
   * point at the SAME daemon — and there, native replacement coalescing the
   * duplicate banners is the desired behavior. `backendId` (the emitting
   * backend) is used only to route the click to a window on that host;
   * omitted for test notifications, whose click accepts any window.
   */
  private showNotification(
    content: NotificationContent,
    workspaceId?: string,
    agentId?: string,
    backendId?: string,
  ): void {
    try {
      // Check if notifications are supported
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        // Still send the sound event even if notifications aren't supported
        this.sendShowEvent(content, backendId ?? ANY_HOST, workspaceId);
        return;
      }

      const stableId = workspaceId && agentId ? `${workspaceId}:${agentId}` : undefined;
      const notification = new Notification({
        title: content.title,
        body: content.body,
        ...(stableId ? { id: stableId } : {}),
      });

      // Keep a strong reference to prevent GC before user interaction
      this.activeNotifications.add(notification);
      if (stableId) {
        // Native replacement may retire the previous same-id notification
        // WITHOUT a 'close' event — evict it here so the set cannot leak.
        const replaced = this.notificationsById.get(stableId);
        if (replaced) {
          this.activeNotifications.delete(replaced);
        }
        this.notificationsById.set(stableId, notification);
      }
      const release = () => {
        this.activeNotifications.delete(notification);
        if (stableId && this.notificationsById.get(stableId) === notification) {
          this.notificationsById.delete(stableId);
        }
      };

      // Focus workspace window on click and navigate to the correct workspace
      notification.on('click', () => {
        release();

        // The emitting host's connection may have been closed while the
        // banner sat in Notification Center (closing a host's last window
        // disposes its client). Never open or navigate a window for a
        // closed host: just bring Intent forward on any regular window.
        const hostLive = backendId === undefined || this.clientFor(backendId) !== undefined;

        // Resolve the target NOW, not when the banner appeared: windows may
        // have closed, navigated to /hud, or moved the workspace while the
        // notification sat in Notification Center. The picker never returns
        // the HUD or a window on another backend.
        const target = hostLive
          ? pickNotificationClickTarget(workspaceId, backendId)
          : pickNotificationClickTarget(undefined, undefined);

        if (!target) {
          if (!hostLive) {
            logger.info('Notification click for a closed host; no window to focus', {
              workspaceId,
              backendId,
            });
            return;
          }
          // No suitable window is live (e.g. only the HUD pop-out, no window
          // on the emitting host, or no windows at all): open a fresh app
          // window on that backend, directly on the workspace route (no IPC
          // race against a still-loading renderer).
          this.openWindowForNotificationClick(workspaceId, backendId);
          return;
        }

        // Activating the app also emits `activate`, whose handler would
        // otherwise raise the main window over this target.
        claimActivationFocus(target);
        activateAppOnMac();
        if (target.isMinimized()) {
          target.restore();
        }
        target.show();
        target.focus();
        if (!hostLive) {
          logger.info('Notification click for a closed host; focused a window without navigating', {
            workspaceId,
            backendId,
          });
          return;
        }
        if (workspaceId && !target.webContents.isDestroyed()) {
          // Chief completions route to the sidebar Assistant panel (the
          // chief workspace page is hidden); everything else keeps the
          // bare `{ workspaceId }` payload.
          const payload =
            workspaceId === CHIEF_WORKSPACE_ID
              ? { workspaceId, chief: true, ...(agentId ? { agentId } : {}) }
              : { workspaceId };
          target.webContents.send('notification:navigate', payload);
        }
      });

      notification.on('close', () => {
        release();
      });

      // Log any errors that occur during notification display
      notification.on('failed', (_event, error) => {
        release();
        logger.error('Notification failed to show', { error });
      });

      try {
        notification.show();
      } catch (error) {
        release();
        logger.error('Notification.show() threw', error as Error);
        return;
      }

      // Send notification:show event to workspace windows for sound playback
      this.sendShowEvent(content, backendId ?? ANY_HOST, workspaceId);

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
   * Notification-click fallback when no suitable window is live: open a
   * fresh app window bound to the emitting backend, loaded directly on the
   * workspace route (home for
   * chief completions, whose workspace page is hidden). Loading the route
   * up-front avoids racing a `notification:navigate` IPC against a renderer
   * that has not registered its listeners yet.
   */
  private openWindowForNotificationClick(
    workspaceId?: string,
    backendId: string = LOCAL_CONNECTION_ID,
  ): void {
    void (async () => {
      try {
        const { createWindowForSession } = await import('../../../main/window');
        const { getMainWindow } = await import('../../../main/state');
        const route =
          workspaceId && workspaceId !== CHIEF_WORKSPACE_ID ? `/workspace/${workspaceId}` : '/';
        const existingMain = getMainWindow();
        const setAsMain = !existingMain || existingMain.isDestroyed();
        const { workArea } = screen.getPrimaryDisplay();
        await createWindowForSession({ route, bounds: workArea }, setAsMain, backendId);
        activateAppOnMac();
        logger.info('Notification click opened a new window (no suitable window was live)', {
          workspaceId,
          backendId,
          route,
        });
      } catch (error) {
        logger.error('Failed to open window for notification click', error as Error);
      }
    })();
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
          error: m.notification_not_supported(),
        };
      }

      // No workspace: the click focuses any regular (non-HUD) window.
      this.showNotification({
        title: m.notification_specialist_agent(),
        body: m.notification_test_body(),
      });
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : m.notifications_web_unknown_error();
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

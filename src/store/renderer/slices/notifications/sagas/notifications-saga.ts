import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { actionChannel, all, call, flush, fork, race, take } from 'typed-redux-saga';

import type { AgentIdleEvent } from '$features/events/types';
import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { playNotificationSoundPerSettings } from '$features/notifications/notification-sound-gate';
import { buildNotificationContent } from '$features/notifications/utils/notification-content';
import { backendRequest } from '$lib/client/live/backend-transport';
import { readSetting } from '$lib/client/live/live-settings-client';
import { isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { getPlatform } from '$lib/utils/platform-capabilities';
import { addMockIpcListener } from '$shared/ipc-mock-router';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  selectNotificationEnabled,
  selectSoundOnlyWhenUnfocused,
} from '../../user-preferences/user-preferences-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';

const logger = createLogger('NotificationsSaga');
const activeNotifications = new Set<Notification>();
let pendingPermissionRequest: Promise<NotificationPermission> | null = null;
let loggedPermissionSkip = false;

type NotificationShowEvent = { title?: string; body?: string; timestamp?: string };
type NotificationNavigateEvent = { workspaceId?: string; chief?: boolean; agentId?: string };
type NativeNotificationEvent =
  | { kind: 'show'; data?: NotificationShowEvent }
  | { kind: 'navigate'; data?: NotificationNavigateEvent | null };
type AgentListResult = {
  agents?: Array<{
    id?: string;
    isStreaming?: boolean;
    isResponding?: boolean;
    metadata?: { isBackground?: boolean; specialist?: string };
  }>;
};

function createNativeNotificationChannel(): EventChannel<NativeNotificationEvent> {
  return eventChannel<NativeNotificationEvent>((emit) => {
    if (typeof window === 'undefined' || !window.electronAPI?.on) return () => {};
    const listeners = [
      [
        'notification:show',
        window.electronAPI.on('notification:show', (data) => emit({ kind: 'show', data })),
      ],
      [
        'notification:navigate',
        window.electronAPI.on('notification:navigate', (data) => emit({ kind: 'navigate', data })),
      ],
    ] as const;
    return () => {
      for (const [channel, id] of listeners) window.electronAPI.offById(channel, id);
    };
  }, buffers.sliding(1_000));
}

function createWebNotificationChannel(): EventChannel<AgentIdleEvent> {
  return eventChannel<AgentIdleEvent>(
    (emit) =>
      addMockIpcListener('agent:idle', (payload) => {
        const event = payload as AgentIdleEvent | undefined;
        if (event?.type === 'agent:idle' && event.data) {
          emit(event);
        }
      }),
    buffers.expanding<AgentIdleEvent>(),
  );
}

async function resolvePermission(): Promise<NotificationPermission> {
  let permission = Notification.permission;
  if (permission === 'default') {
    pendingPermissionRequest ??= Promise.resolve(Notification.requestPermission()).finally(() => {
      pendingPermissionRequest = null;
    });
    permission = await pendingPermissionRequest;
  }
  return permission;
}

async function ensurePermission(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    if (!loggedPermissionSkip)
      logger.warn('Browser Notification API is not available; skipping web notifications');
    loggedPermissionSkip = true;
    return false;
  }
  try {
    const permission = await resolvePermission();
    if (permission === 'granted') return true;
    if (!loggedPermissionSkip)
      logger.info('Notification permission not granted; web notifications disabled', {
        permission,
      });
  } catch (error) {
    if (!loggedPermissionSkip) logger.warn('Notification permission request failed', { error });
  }
  loggedPermissionSkip = true;
  return false;
}

function createBrowserNotification(title: string, body: string): Notification {
  return new Notification(title, { body });
}

function* showBrowserNotification(
  title: string,
  body: string,
  workspaceId: string,
  agentId: string,
) {
  yield* fork(playNotificationSoundPerSettings);
  const granted: boolean = yield* call(ensurePermission);
  if (!granted) return;
  try {
    const notification: Notification = yield* call(createBrowserNotification, title, body);
    activeNotifications.add(notification);
    notification.onclick = () => {
      activeNotifications.delete(notification);
      try {
        window.focus();
      } catch {
        /* Navigation still runs. */
      }
      const payload =
        workspaceId === CHIEF_WORKSPACE_ID
          ? { workspaceId, chief: true, agentId }
          : { workspaceId };
      void handleNotificationNavigate(payload);
      notification.close();
    };
    notification.onclose = () => activeNotifications.delete(notification);
    notification.onerror = () => {
      activeNotifications.delete(notification);
      logger.warn('Web notification failed to show', { title });
    };
  } catch (error) {
    logger.warn('Failed to show web notification', { error });
  }
}

function* handleWebIdle(event: AgentIdleEvent, activeWorkspaceId: string | null) {
  try {
    const workspaceId = event.workspaceId;
    if (!workspaceId) return;
    const [fallbackEnabled, fallbackSoundOnly] = yield* all([
      selectNotificationEnabled.effect(),
      selectSoundOnlyWhenUnfocused.effect(),
    ]);
    let enabled = fallbackEnabled ?? true;
    let soundOnlyWhenUnfocused = fallbackSoundOnly ?? true;
    try {
      const [enabledResult, soundResult] = yield* all([
        call(readSetting, 'notifications.enabled'),
        call(readSetting, 'notifications.soundOnlyWhenUnfocused'),
      ]);
      const enabledValue = enabledResult?.value;
      const soundValue = soundResult?.value;
      if (typeof enabledValue === 'boolean') enabled = enabledValue;
      if (typeof soundValue === 'boolean') soundOnlyWhenUnfocused = soundValue;
    } catch (error) {
      logger.warn('Failed to fetch notifications.* settings from daemon', { error });
    }
    // Fast path: skip when the workspace is archived (archived workspaces
    // never notify; field absent on older daemons), when the agent is
    // waiting on other agents (§5.5), active background hooks (§3.1), or
    // active PR monitors (§5.42) — it will run again on its own, so the
    // workspace isn't truly quiet yet. Both hook/monitor fields are absent
    // on older daemons.
    if (event.data.workspaceArchived === true) {
      logger.debug('Skipping notification for archived workspace', { workspaceId });
      return;
    }
    if (
      !enabled ||
      event.data.isBackground ||
      event.data.isWaitingForOtherAgents ||
      (event.data.waitingOnHooks?.length ?? 0) > 0 ||
      (event.data.waitingOnPrMonitors?.length ?? 0) > 0
    ) {
      return;
    }

    const agentList = (yield* call(backendRequest, 'agent.list', { workspaceId })) as
      AgentListResult | undefined;
    const agents = agentList?.agents ?? [];
    const idleAgent = agents.find((agent) => agent.id === event.data.agentId);
    if (idleAgent?.metadata?.isBackground) return;
    if (
      agents.some(
        (agent) => agent.id !== event.data.agentId && (agent.isStreaming || agent.isResponding),
      )
    )
      return;

    const isChief = workspaceId === CHIEF_WORKSPACE_ID;
    let workspaceTitle: string | undefined;
    if (!isChief) {
      try {
        const response = (yield* call(backendRequest, 'workspace.get', { workspaceId })) as
          { workspace?: { title?: string } } | undefined;
        if (response?.workspace?.title) workspaceTitle = response.workspace.title;
      } catch {
        // Missing workspace context is non-fatal.
      }
    }
    const content = buildNotificationContent(
      {
        isChief,
        agentName: event.data.agentName,
        specialist: event.data.specialist ?? idleAgent?.metadata?.specialist,
        taskTitle: event.data.taskTitle,
      },
      workspaceTitle,
    );
    if (
      typeof document !== 'undefined' &&
      document.hasFocus() &&
      activeWorkspaceId === workspaceId &&
      soundOnlyWhenUnfocused
    ) {
      yield* fork(playNotificationSoundPerSettings);
      return;
    }
    yield* call(
      showBrowserNotification,
      content.title,
      content.body,
      workspaceId,
      event.data.agentId,
    );
  } catch (error) {
    logger.error('Failed to handle agent:idle event', error);
  }
}

function* handleNativeNotificationEvent(event: NativeNotificationEvent) {
  try {
    if (event.kind === 'show') yield* call(playNotificationSoundPerSettings);
    else yield* call(handleNotificationNavigate, event.data);
  } catch {
    // Native notification effects are best-effort and independent.
  }
}

export function* notificationIpcSaga() {
  if (!isElectron()) return;
  const channel = createNativeNotificationChannel();
  try {
    while (true) {
      const event: NativeNotificationEvent = yield* take(channel);
      if (event === (END as unknown as NativeNotificationEvent)) break;
      yield* fork(handleNativeNotificationEvent, event);
    }
  } finally {
    channel.close();
  }
}

export function* webNotificationSaga() {
  if (getPlatform() !== 'web') return;
  const channel = createWebNotificationChannel();
  const workspaceChanges = yield* actionChannel(
    CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
    buffers.expanding(),
  );
  let activeWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  try {
    while (true) {
      const { event, workspaceChange } = yield* race({
        event: take(channel),
        workspaceChange: take(workspaceChanges),
      });
      if (workspaceChange) {
        yield* flush(workspaceChanges);
        activeWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
        continue;
      }
      if (!event || event === (END as unknown as AgentIdleEvent)) break;
      yield* fork(handleWebIdle, event, activeWorkspaceId);
    }
  } finally {
    workspaceChanges.close();
    channel.close();
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
  }
}

import { waitFor } from '@themislib/themis/saga';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { DEFAULT_DISCUSSION_ID } from '$shared/types/workspace-discussion';
import {
  discussionMessageReceived,
  discussionPageReceived,
  discussionMetadataProgress,
  discussionSendSucceeded,
} from '../../workspace-discussion/workspace-discussion-slice';
import { selectDiscussionOwner } from '../../workspace-discussion/workspace-discussion-selectors';
import {
  selectDiscussionMentionAdmission,
  selectDiscussionMentionCandidate,
  selectDiscussionMentionVisible,
  selectDiscussionNotificationHistory,
  selectDiscussionNotificationLayout,
} from '../notifications-selectors';
import type { NotificationNavigatePayload } from '$features/notifications/notification-navigation';
import { discussionNotificationLayoutRequested } from '../notifications-slice';
import type { StoreState } from '../../../types';
import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  cancelled,
  flush,
  fork,
  getContext,
  put,
  race,
  take,
  takeEvery,
} from 'typed-redux-saga';

import type { AgentIdleEvent } from '$features/events/types';
import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { playNotificationSoundPerSettings } from '$features/notifications/notification-sound-gate';
import { readIdleNotificationGate } from '$features/notifications/utils/idle-gate';
import { buildNotificationContent } from '$features/notifications/utils/notification-content';
import { backendRequest } from '$lib/client/live/backend-transport';
import { readSetting } from '$lib/client/live/live-settings-client';
import { selectHostAdministrationContext } from '../../principal/principal-selectors';
import { isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { getPlatform } from '$lib/utils/platform-capabilities';
import { eventReceived } from '../../workspace-events/workspace-events-slice';
import {
  selectAgentSession,
  selectAgentDetailHydrated,
} from '../../agent-session/agent-session-selectors';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
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
  context: string,
  discussion?: NonNullable<NotificationNavigatePayload['discussion']>,
) {
  yield* fork(playNotificationSoundPerSettings);
  const granted: boolean = yield* call(ensurePermission);
  if (!granted || context !== (yield* selectPrincipalActionContext.effect())) return;
  if (discussion) {
    const admitted = yield* selectDiscussionMentionAdmission.effect(
      discussion.target,
      discussion.messageId,
    );
    if (!admitted || admitted === 'pending') return;
    if (document.hasFocus() && document.visibilityState === 'visible') {
      yield* call(showDiscussionToast, discussion);
      return;
    }
  }
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
      const payload = discussion
        ? { workspaceId, discussion }
        : workspaceId === CHIEF_WORKSPACE_ID
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
    const context = yield* selectPrincipalActionContext.effect();
    if (!workspaceId || !context) return;
    const reduxStore = yield* getContext<{ getState: () => StoreState }>('reduxStore');
    const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
      if (context !== selectPrincipalActionContext.select(reduxStore.getState()))
        throw new Error('Notification admission changed');
      const result = await backendRequest(method, params);
      if (context !== selectPrincipalActionContext.select(reduxStore.getState()))
        throw new Error('Notification admission changed');
      return result;
    };
    const [fallbackEnabled, fallbackSoundOnly] = yield* all([
      selectNotificationEnabled.effect(),
      selectSoundOnlyWhenUnfocused.effect(),
    ]);
    let enabled = fallbackEnabled ?? true;
    let soundOnlyWhenUnfocused = fallbackSoundOnly ?? true;
    try {
      const ownerContext = yield* selectHostAdministrationContext.effect();
      const [enabledResult, soundResult] = ownerContext
        ? yield* all([
            call(readSetting, 'notifications.enabled'),
            call(readSetting, 'notifications.soundOnlyWhenUnfocused'),
          ])
        : [null, null];
      if (ownerContext !== (yield* selectHostAdministrationContext.effect())) return;
      const enabledValue = enabledResult?.value;
      const soundValue = soundResult?.value;
      if (typeof enabledValue === 'boolean') enabled = enabledValue;
      if (typeof soundValue === 'boolean') soundOnlyWhenUnfocused = soundValue;
    } catch (error) {
      logger.warn('Failed to fetch notifications.* settings from daemon', { error });
    }
    // Fast path: skip when the workspace is archived (archived workspaces
    // never notify; field absent on older daemons), when the agent is muted
    // (§5.5 `notificationsMuted`, stamped only when true), when the agent is
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
      event.data.notificationsMuted === true ||
      event.data.isWaitingForOtherAgents ||
      (event.data.waitingOnHooks?.length ?? 0) > 0 ||
      (event.data.waitingOnPrMonitors?.length ?? 0) > 0 ||
      (event.data.waitingOnScriptMonitors?.length ?? 0) > 0
    ) {
      return;
    }

    if (context !== (yield* selectPrincipalActionContext.effect())) return;
    const known = yield* selectAgentSession.effect(event.data.agentId);
    const hydrated = yield* selectAgentDetailHydrated.effect(event.data.agentId);
    // Accepted detail metadata already supplies self flags and specialist.
    // The global sibling gate still needs backend truth for unloaded agents.
    const verdict = yield* call(readIdleNotificationGate, request, {
      workspaceId,
      agentId: event.data.agentId,
      knownIdleAgent: hydrated && known?.workspaceId === workspaceId ? known : undefined,
    });
    if (context !== (yield* selectPrincipalActionContext.effect())) return;
    if (verdict.kind !== 'notify') return;
    const idleAgent = verdict.idleAgent;

    const isChief = workspaceId === CHIEF_WORKSPACE_ID;
    let workspaceTitle: string | undefined;
    if (!isChief) {
      try {
        const response = (yield* call(request, 'workspace.get', { workspaceId })) as
          { workspace?: { title?: string } } | undefined;
        if (response?.workspace?.title) workspaceTitle = response.workspace.title;
      } catch {
        // Missing workspace context is non-fatal.
      }
    }
    if (context !== (yield* selectPrincipalActionContext.effect())) return;
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
      context,
    );
  } catch (error) {
    logger.error('Failed to handle agent:idle event', error);
  }
}

function* showDiscussionToast(discussion: NonNullable<NotificationNavigatePayload['discussion']>) {
  const { target, messageId } = discussion;
  const message = yield* selectDiscussionMentionAdmission.effect(target, messageId);
  if (!message || message === 'pending') return;
  const visible = yield* selectDiscussionMentionVisible.effect(
    target.workspaceId,
    target.conversationId,
  );
  if (visible && window.location.pathname.startsWith('/workspace/')) return;
  yield* call(
    notify.info,
    m.notifications_discussion_mention_title({
      name:
        message.author.displayName ||
        message.author.login ||
        m.workspace_discussion_unknownAuthor_label(),
    }),
    {
      key: JSON.stringify([
        'discussion-mention',
        target.context,
        target.workspaceId,
        target.conversationId,
        messageId,
      ]),
      description: message.body,
      action: {
        label: m.notifications_discussion_open_label(),
        onClick: () => handleNotificationNavigate({ workspaceId: target.workspaceId, discussion }),
      },
    },
  );
  yield* call(playNotificationSoundPerSettings);
}

function* handleDiscussionMention(action: ReturnType<typeof discussionMessageReceived>) {
  const [target, incoming] = action.payload;
  try {
    const ready = yield* waitFor(
      selectDiscussionMentionAdmission,
      [target, incoming.id],
      (value) => value !== 'pending',
      10_000,
    );
    if (!ready) return;
    const message = yield* selectDiscussionMentionAdmission.effect(target, incoming.id);
    if (!message || message === 'pending') return;
    const discussion = { target, messageId: message.id };
    if (document.hasFocus() && document.visibilityState === 'visible') {
      yield* call(showDiscussionToast, discussion);
    } else {
      yield* call(
        showBrowserNotification,
        m.notifications_discussion_mention_title({
          name:
            message.author.displayName ||
            message.author.login ||
            m.workspace_discussion_unknownAuthor_label(),
        }),
        message.body,
        target.workspaceId,
        '',
        target.context,
        discussion,
      );
    }
  } catch (error) {
    logger.warn('Failed to show discussion mention notification', { error });
  }
}

function* waitForDiscussionNotificationLayout(
  action: ReturnType<typeof discussionNotificationLayoutRequested>,
) {
  const [target, messageId] = action.payload;
  try {
    const settled = yield* waitFor(
      selectDiscussionNotificationLayout,
      [target, messageId],
      (status) => status !== 'pending',
      10_000,
    );
    yield* put(
      action.success(
        settled &&
          (yield* selectDiscussionNotificationLayout.effect(target, messageId)) === 'ready',
      ),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  } finally {
    if (yield* cancelled())
      yield* put(action.failure(new Error('Discussion notification navigation cancelled')));
  }
}

/** Notification fan-out only: discussion ingestion and transport remain with their existing owners. */
function* watchDiscussionMentions() {
  if (typeof window === 'undefined' || window.location.pathname.startsWith('/hud')) return;
  yield* takeEvery(discussionNotificationLayoutRequested, waitForDiscussionNotificationLayout);
  const seen = new Set(yield* selectDiscussionNotificationHistory.effect());
  const channel = yield* actionChannel(
    [
      discussionMessageReceived,
      discussionPageReceived,
      discussionMetadataProgress,
      discussionSendSucceeded,
    ],
    buffers.expanding(),
  );
  try {
    while (true) {
      const action = yield* take(channel);
      if (action.type !== discussionMessageReceived.type) {
        for (const key of yield* selectDiscussionNotificationHistory.effect()) seen.add(key);
        continue;
      }
      const received = action as ReturnType<typeof discussionMessageReceived>;
      const [target, message] = received.payload;
      const owner = yield* selectDiscussionOwner.effect();
      if (!owner) continue;
      const key = JSON.stringify([
        owner,
        target.workspaceId,
        target.conversationId ?? DEFAULT_DISCUSSION_ID,
        message.id,
      ]);
      if (seen.has(key)) continue;
      // Do not let a rejected old-context event poison a later admitted copy.
      if (!(yield* selectDiscussionMentionCandidate.effect(target, message.id))) continue;
      seen.add(key);
      yield* fork(handleDiscussionMention, received);
    }
  } finally {
    channel.close();
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
  yield* fork(watchDiscussionMentions);
  const channel = createNativeNotificationChannel();
  try {
    while (true) {
      const event: NativeNotificationEvent = yield* take(channel);
      if (event === (END as unknown as NativeNotificationEvent)) break;
      yield* fork(handleNativeNotificationEvent, event);
    }
  } finally {
    channel.close();
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
  }
}

export function* webNotificationSaga() {
  if (getPlatform() !== 'web') return;
  yield* fork(watchDiscussionMentions);
  const channel = yield* actionChannel(eventReceived, buffers.expanding());
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
      if (!event) break;
      const idle = event.payload[1];
      if (idle.type === 'agent:idle' && idle.data)
        yield* fork(handleWebIdle, idle as AgentIdleEvent, activeWorkspaceId);
    }
  } finally {
    workspaceChanges.close();
    channel.close();
    for (const notification of activeNotifications) notification.close();
    activeNotifications.clear();
  }
}

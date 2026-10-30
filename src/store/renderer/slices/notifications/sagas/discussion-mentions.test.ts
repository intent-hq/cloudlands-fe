import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
import {
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionRequested,
  discussionMessageReceived,
  discussionPageReceived,
  discussionLoadStarted,
  discussionPrincipalMentionsCapabilityReceived,
  discussionMembershipInvalidated,
  discussionConversationReceived,
  discussionConversationDeleted,
  discussionCapabilityReceived,
} from '../../workspace-discussion/workspace-discussion-slice';
import {
  selectDiscussionContext,
  selectDiscussionOwner,
  selectDiscussionTarget,
  selectDiscussionUnread,
  selectDiscussionConversations,
} from '../../workspace-discussion/workspace-discussion-selectors';
import {
  setLabsMultiplayerEnabled,
  setNotificationEnabled,
} from '../../user-preferences/user-preferences-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import {
  selectCurrentWorkspaceTabId,
  selectIsWorkspaceTabOpen,
} from '../../tab-state/tab-state-selectors';
import { initializeLayout, setRestoreStatus } from '../../panel-layout/panel-layout-slice';
import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { webNotificationSaga, notificationIpcSaga } from './notifications-saga';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  sound: vi.fn(),
  route: vi.fn(async () => {}),
  open: vi.fn(),
  electron: vi.fn(() => false),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: mocks.toast } }));
vi.mock('$features/notifications/notification-sound-gate', () => ({
  playNotificationSoundPerSettings: mocks.sound,
}));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.route }));
vi.mock('$features/discussions/discussion-navigation', () => ({
  openWorkspaceDiscussion: mocks.open,
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.electron }));
vi.mock('$lib/utils/platform-capabilities', () => ({ getPlatform: () => 'web' }));

class BrowserNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
  static instances: BrowserNotification[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: { body?: string },
  ) {
    BrowserNotification.instances.push(this);
  }
}
const message = (id = 'message-1', sequence = 1): DiscussionMessage => ({
  id,
  sequence,
  workspaceId: 'ws',
  conversationId: 'default',
  body: '@Sam please review',
  author: { principalId: 'other', displayName: 'Amelia', login: null, avatarUrl: null },
  createdAt: '2026-10-22T00:00:00Z',
  principalMentions: [{ principalId: 'principal', name: 'Sam', start: 0, end: 4 }],
});
const target = () => selectDiscussionTarget.select(store.state, 'ws')!;
const emit = (value = message()) => store.dispatch(discussionMessageReceived(target(), value));
const settle = () => vi.advanceTimersByTimeAsync(0);

function layout(active = 'discussion', secondary = false, { openTab = true } = {}) {
  if (openTab) store.dispatch(openWorkspaceTab('ws'));
  const tab = {
    id: 'discussion',
    type: 'discussion' as const,
    title: 'Discussion',
    workspaceId: 'ws',
    closable: true,
    data: { conversationId: 'default' },
  };
  const agent = { id: 'agent', type: 'agent' as const, title: 'Agent', closable: true };
  store.dispatch(
    initializeLayout('ws', {
      root: secondary
        ? {
            type: 'split',
            direction: 'horizontal',
            sizes: [50, 50],
            children: [
              { type: 'panel', panelId: 'first' },
              { type: 'panel', panelId: 'second' },
            ],
          }
        : { type: 'panel', panelId: 'first' },
      panels: {
        first: {
          id: 'first',
          tabs: secondary ? [agent] : [agent, tab],
          activeTabId: secondary ? 'agent' : active,
        },
        ...(secondary ? { second: { id: 'second', tabs: [tab], activeTabId: 'discussion' } } : {}),
      },
      focusedPanelId: 'first',
    }),
  );
  store.dispatch(setRestoreStatus('ws', 'restored'));
}

describe('live discussion mention notifications', () => {
  let dispose: () => void;
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.electron.mockReturnValue(false);
    mocks.route.mockImplementation(async () => {
      layout('agent');
    });
    BrowserNotification.permission = 'granted';
    BrowserNotification.instances = [];
    BrowserNotification.requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', BrowserNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(window, 'focus').mockImplementation(() => {});
    window.history.replaceState({}, '', '/workspace/other');
    dispose = store.init();
    store.dispatch(setLabsMultiplayerEnabled(true));
    store.dispatch(setNotificationEnabled(true));
    admitLegacyPrincipal();
    store.dispatch(
      replaceWorkspaceList([
        { id: WorkspaceId('ws') },
        { id: WorkspaceId('other') },
      ] as Workspace[]),
    );
    const context = selectDiscussionContext.select(store.state)!;
    store.dispatch(discussionContextChanged(context, selectDiscussionOwner.select(store.state)));
    store.dispatch(discussionWorkspacesChanged(['ws', 'other']));
    store.dispatch(discussionRequested('ws'));
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, true));
    store.dispatch(openWorkspaceTab('other'));
    stop = store.runSaga(webNotificationSaga);
  });
  afterEach(() => {
    stop();
    dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('alerts in another workspace and opens the exact conversation', async () => {
    emit();
    await settle();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(BrowserNotification.instances).toHaveLength(0);
    await mocks.toast.mock.calls[0][1].action.onClick();
    expect(mocks.route).toHaveBeenCalledWith('/workspace/ws');
    expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'default');
  });
  it.each([true, false])(
    'retains an unopened private event until capabilities settle to supported=%s',
    async (supported) => {
      const context = selectDiscussionContext.select(store.state)!;
      store.dispatch(discussionContextChanged(null, null));
      store.dispatch(discussionContextChanged(context, selectDiscussionOwner.select(store.state)));
      store.dispatch(discussionWorkspacesChanged(['ws', 'other']));
      const incoming = { ...message('first-live', 12), conversationId: 'private' };
      const event = {
        subscriptionId: 'current',
        event: {
          id: 'first-live-event',
          type: 'discussion:message',
          workspaceId: 'ws',
          data: {
            workspaceId: 'ws',
            conversationId: 'private',
            conversation: {
              id: 'private',
              workspaceId: 'ws',
              kind: 'direct',
              participants: [
                incoming.author,
                { principalId: 'principal', displayName: 'Sam', login: null, avatarUrl: null },
              ],
              createdAt: incoming.createdAt,
            },
            message: incoming,
          },
        },
      };
      routeDaemonEventsNotification('events.event', event, ['current']);
      await settle();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(selectDiscussionUnread.select(store.state, 'ws', 'private').count).toBe(0);
      expect(selectDiscussionConversations.select(store.state, 'ws')).toEqual([]);
      store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, true));
      await settle();
      expect(mocks.toast).not.toHaveBeenCalled();
      store.dispatch(discussionCapabilityReceived(context, supported));
      await settle();
      expect(mocks.toast).toHaveBeenCalledTimes(supported ? 1 : 0);
      expect(selectDiscussionUnread.select(store.state, 'ws', 'private').count).toBe(
        supported ? 1 : 0,
      );
      routeDaemonEventsNotification('events.event', event, ['current']);
      await settle();
      expect(mocks.toast).toHaveBeenCalledTimes(supported ? 1 : 0);
      expect(selectDiscussionUnread.select(store.state, 'ws', 'private').count).toBe(
        supported ? 1 : 0,
      );
      expect(selectDiscussionConversations.select(store.state, 'ws').map((row) => row.id)).toEqual(
        supported ? ['private'] : [],
      );
    },
  );
  it('opens the specific private conversation, not the workspace-wide discussion', async () => {
    const context = target().context;
    store.dispatch(discussionCapabilityReceived(context, true));
    store.dispatch(
      discussionConversationReceived(context, {
        id: 'direct-1',
        workspaceId: 'ws',
        kind: 'direct',
        createdAt: message().createdAt,
        participants: [
          { principalId: 'principal', displayName: 'Sam', login: null, avatarUrl: null },
          { principalId: 'other', displayName: 'Amelia', login: null, avatarUrl: null },
        ],
      }),
    );
    const destination = selectDiscussionTarget.select(store.state, 'ws', 'direct-1')!;
    store.dispatch(
      discussionMessageReceived(destination, { ...message(), conversationId: 'direct-1' }),
    );
    await settle();
    await mocks.toast.mock.calls[0][1].action.onClick();
    expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'direct-1');
  });
  it.each(['before-alert', 'before-click', 'pending-capability'])(
    'keeps named discussion mentions working after default deletion (%s)',
    async (timing) => {
      const context = target().context;
      if (timing !== 'pending-capability')
        store.dispatch(discussionCapabilityReceived(context, true));
      store.dispatch(
        discussionConversationReceived(context, {
          id: 'named',
          workspaceId: 'ws',
          kind: 'workspace',
          name: 'Design',
          participants: [],
          createdAt: message().createdAt,
        }),
      );
      if (timing !== 'before-click')
        store.dispatch(discussionConversationDeleted(context, 'ws', 'default'));
      const destination = selectDiscussionTarget.select(store.state, 'ws', 'named')!;
      store.dispatch(
        discussionMessageReceived(destination, { ...message(), conversationId: 'named' }),
      );
      await settle();
      if (timing === 'pending-capability') {
        expect(mocks.toast).not.toHaveBeenCalled();
        store.dispatch(discussionCapabilityReceived(context, true));
        await settle();
      }
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      if (timing === 'before-click')
        store.dispatch(discussionConversationDeleted(context, 'ws', 'default'));
      expect(store.state.workspaceDiscussion.deletedKeys).toContain(
        JSON.stringify(['ws', 'default']),
      );
      await mocks.toast.mock.calls[0][1].action.onClick();
      expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'named');

      mocks.open.mockClear();
      mocks.route.mockClear();
      store.dispatch(discussionConversationDeleted(context, 'ws', 'named'));
      await mocks.toast.mock.calls[0][1].action.onClick();
      expect(mocks.route).not.toHaveBeenCalled();
      expect(mocks.open).not.toHaveBeenCalled();
    },
  );
  it('does not replay an alert skipped while notifications were disabled', async () => {
    store.dispatch(setNotificationEnabled(false));
    emit();
    await settle();
    store.dispatch(setNotificationEnabled(true));
    emit();
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('drops a pending capability alert when its owner context is lost', async () => {
    const owner = selectDiscussionOwner.select(store.state);
    store.dispatch(discussionContextChanged(null, owner));
    store.dispatch(discussionContextChanged(selectDiscussionContext.select(store.state), owner));
    const context = target().context;
    emit();
    await settle();
    store.dispatch(discussionContextChanged(null, null));
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, true));
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('alerts for a hidden discussion tab', async () => {
    layout('agent');
    window.history.replaceState({}, '', '/workspace/ws');
    emit();
    await settle();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    'suppresses a visible discussion, including another panel (%s)',
    async (secondary) => {
      layout('discussion', secondary);
      window.history.replaceState({}, '', '/workspace/ws');
      emit();
      await settle();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(mocks.sound).not.toHaveBeenCalled();
    },
  );
  it('does not treat retained workspace panels behind settings as visible', async () => {
    layout();
    window.history.replaceState({}, '', '/settings');
    emit();
    await settle();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it('deduplicates IDs while preserving out-of-order live messages', async () => {
    emit(message('second', 2));
    emit(message('first', 1));
    emit(message('second', 2));
    await settle();
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
  it('never alerts for a history page or its replay as a live event', async () => {
    const t = target();
    store.dispatch(discussionLoadStarted(t, 'load', false));
    store.dispatch(
      discussionPageReceived(t, 'load', { messages: [message()], hasMore: false }, 'initial'),
    );
    emit();
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('seeds duplicate protection from messages accepted before saga startup', async () => {
    stop();
    emit();
    stop = store.runSaga(webNotificationSaga);
    emit();
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each([
    'wrong-person',
    'self',
    'text-only',
    'disabled',
    'labs-off',
    'capability-off',
    'stale-context',
    'stale-epoch',
  ])('skips %s', async (kind) => {
    const value = message();
    let t = target();
    if (kind === 'wrong-person') value.principalMentions![0].principalId = 'someone-else';
    if (kind === 'self') value.author = { ...value.author, principalId: 'principal' };
    if (kind === 'text-only') delete value.principalMentions;
    if (kind === 'disabled') store.dispatch(setNotificationEnabled(false));
    if (kind === 'labs-off') store.dispatch(setLabsMultiplayerEnabled(false));
    if (kind === 'capability-off')
      store.dispatch(discussionPrincipalMentionsCapabilityReceived(t.context, false));
    if (kind === 'stale-context') t = { ...t, context: 'old' };
    if (kind === 'stale-epoch') t = { ...t, epoch: t.epoch - 1 };
    store.dispatch(discussionMessageReceived(t, value));
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(BrowserNotification.instances).toHaveLength(0);
  });
  it('waits for pending capability admission without another capability request', async () => {
    store.dispatch(discussionContextChanged(null, selectDiscussionOwner.select(store.state)));
    store.dispatch(
      discussionContextChanged(
        selectDiscussionContext.select(store.state),
        selectDiscussionOwner.select(store.state),
      ),
    );
    emit();
    await settle();
    expect(mocks.toast).not.toHaveBeenCalled();
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(target().context, true));
    await settle();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
  it.each(['denied', 'context', 'disabled', 'membership'])(
    'rechecks %s while browser permission is pending',
    async (kind) => {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      let resolve!: (permission: NotificationPermission) => void;
      BrowserNotification.permission = 'default';
      BrowserNotification.requestPermission.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      emit();
      await settle();
      if (kind === 'context') store.dispatch(discussionContextChanged(null, null));
      if (kind === 'disabled') store.dispatch(setNotificationEnabled(false));
      if (kind === 'membership') store.dispatch(discussionMembershipInvalidated('ws'));
      resolve(kind === 'denied' ? 'denied' : 'granted');
      await settle();
      expect(BrowserNotification.instances).toHaveLength(0);
    },
  );
  it('uses system delivery when unfocused, routes its click and cleans up', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    emit();
    await settle();
    const notification = BrowserNotification.instances[0];
    expect(notification.options.body).toBe(message().body);
    expect(mocks.toast).not.toHaveBeenCalled();
    notification.onclick?.();
    await settle();
    expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'default');
    expect(notification.close).toHaveBeenCalled();
    emit(message('another', 2));
    await settle();
    stop();
    expect(BrowserNotification.instances[1].close).toHaveBeenCalled();
  });
  it('uses the same delivery worker under the Electron notification owner', async () => {
    stop();
    mocks.electron.mockReturnValue(true);
    Object.assign(window, { electronAPI: { on: vi.fn(), offById: vi.fn() } });
    stop = store.runSaga(notificationIpcSaga);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    emit();
    await settle();
    expect(BrowserNotification.instances).toHaveLength(1);
    stop();
    delete window.electronAPI;
  });
  it('waits for panels to finish restoring before opening the conversation', async () => {
    mocks.route.mockImplementationOnce(async () => {
      store.dispatch(setRestoreStatus('ws', 'pending'));
    });
    emit();
    await settle();
    const click = mocks.toast.mock.calls[0][1].action.onClick();
    await settle();
    expect(mocks.open).not.toHaveBeenCalled();
    layout('agent');
    await settle();
    await click;
    expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'default');
  });
  it('drops a click when membership changes during panel restoration', async () => {
    mocks.route.mockImplementationOnce(async () => {
      store.dispatch(setRestoreStatus('ws', 'pending'));
    });
    emit();
    await settle();
    const click = mocks.toast.mock.calls[0][1].action.onClick();
    await settle();
    store.dispatch(discussionMembershipInvalidated('ws'));
    await settle();
    await click;
    layout('agent');
    await settle();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('settles the layout request when the notification owner is cancelled', async () => {
    mocks.route.mockImplementationOnce(async () => {
      store.dispatch(setRestoreStatus('ws', 'pending'));
    });
    emit();
    await settle();
    const click = mocks.toast.mock.calls[0][1].action.onClick();
    await settle();
    stop();
    await click;
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('opens the workspace tab when it is not already open', async () => {
    emit();
    await settle();
    mocks.route.mockImplementationOnce(async () => {
      layout('agent', false, { openTab: false });
    });
    expect(selectIsWorkspaceTabOpen.select(store.state, 'ws')).toBe(false);
    await mocks.toast.mock.calls[0][1].action.onClick();
    expect(mocks.route).toHaveBeenCalledWith('/workspace/ws');
    expect(selectIsWorkspaceTabOpen.select(store.state, 'ws')).toBe(true);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('ws');
    expect(mocks.open).toHaveBeenCalledWith('ws', 'ws', 'default');
  });
  it('rejects stale toast clicks before navigation', async () => {
    emit();
    await settle();
    store.dispatch(discussionMembershipInvalidated('ws'));
    await mocks.toast.mock.calls[0][1].action.onClick();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('rechecks admission after asynchronous route navigation', async () => {
    emit();
    await settle();
    mocks.route.mockImplementationOnce(async () => {
      store.dispatch(setLabsMultiplayerEnabled(false));
    });
    await handleNotificationNavigate({
      workspaceId: 'ws',
      discussion: { target: target(), messageId: 'message-1' },
    });
    expect(mocks.route).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
  });
});

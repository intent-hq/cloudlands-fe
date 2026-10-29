import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { workspaceDiscussionClient } from '$lib/client/live/workspace-discussion';
import { settingsChanged } from '../../settings-events/settings-events-slice';
import { initializeLayout, closeTab, reopenClosedTab } from '../../panel-layout/panel-layout-slice';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import type {
  DiscussionConversation,
  DiscussionMessage,
  DiscussionAgentActivity,
} from '$shared/types/workspace-discussion';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../../store';
import { authRejectedReceived, connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import {
  selectPrincipalConnectionContext,
  selectPrincipalActionContext,
} from '../../principal/principal-selectors';
import {
  discussionManagementCapabilityReceived,
  discussionRenameRequested,
  discussionDeleteRequested,
  discussionReadThrough,
  discussionAgentSelected,
  discussionPrincipalSelected,
  discussionPrincipalMentionsCapabilityReceived,
  discussionAgentControlRequested,
  discussionAgentRemoved,
  discussionAgentCapabilityReceived,
  discussionReplySelected,
  discussionReactionRequested,
  discussionEnableSharingRequested,
  discussionRequested,
  discussionOlderRequested,
  discussionDraftChanged,
  discussionSendRequested,
  discussionRetryRequested,
  discussionMessageReceived,
  discussionDirectoryRequested,
  discussionRecipientsRequested,
  discussionRecipientsChanged,
  discussionNewRequested,
  discussionMembershipInvalidated,
} from '../workspace-discussion-slice';
import {
  selectDiscussionDefaultVisible,
  selectDiscussionCanTargetAgents,
  selectDiscussionCanRename,
  selectDiscussionCanDelete,
  selectDiscussionManagementPending,
  selectDiscussionManagement,
  selectDiscussionReadOnly,
  selectDiscussionUnread,
  selectDiscussionCanSend,
  selectDiscussionCanInteract,
  selectDiscussionMessages,
  selectDiscussionConversations,
  selectDiscussionRecipients,
  selectDiscussionCreatedId,
  selectDiscussionCanCreate,
  selectDiscussionPending,
  selectDiscussionTarget,
  selectDiscussionReady,
  selectWorkspaceDiscussion,
} from '../workspace-discussion-selectors';
import { workspaceDiscussionSaga } from './workspace-discussion-saga';

const wire = vi.hoisted(() => ({ request: vi.fn(), readSetting: vi.fn() }));
vi.mock('$lib/client/live/live-settings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/live-settings-client')>()),
  readSetting: wire.readSetting,
  invalidateSettingsReadCache: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire.request }));
const message = (sequence: number, workspaceId = 'ws', body = 'hello'): DiscussionMessage => ({
  id: `server-${sequence}`,
  workspaceId,
  sequence,
  body,
  author: { principalId: 'me', login: 'sam', displayName: null, avatarUrl: null },
  createdAt: '2026-10-14T10:00:00Z',
});
const page = (start: number, end: number, hasMore = false) => ({
  messages: Array.from({ length: end - start + 1 }, (_, i) => message(start + i)),
  hasMore,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function admit(id = 'me') {
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: {
          id,
          hostRole: 'owner',
          hostMembershipRevision: 1,
          isAdministrator: true,
          login: null,
          displayName: null,
          avatarUrl: null,
        },
        capabilities: {
          hostMembership: true,
          collaborationIdentity: true,
          personalPairing: true,
          authenticatedDevices: true,
        },
      },
    ),
  );
}
const workspace = (id = 'ws') =>
  ({
    id: WorkspaceId(id),
    memberCount: 2,
    ownerPrincipalId: 'me',
    myRole: 'owner',
    canManage: true,
  }) as Workspace;
const settle = () => vi.advanceTimersByTimeAsync(0);
const row = () => selectWorkspaceDiscussion.select(store.state, 'ws');
const messages = () => selectDiscussionMessages.select(store.state, 'ws');
const pending = () => selectDiscussionPending.select(store.state, 'ws');

describe('workspace discussion transport', () => {
  let dispose: () => void;
  let cancel: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    dispose = store.init();
    vi.spyOn(workspaceDiscussionClient, 'supportsMessageActions').mockResolvedValue(false);
    vi.spyOn(workspaceDiscussionClient, 'supportsReactions').mockResolvedValue(false);
    vi.spyOn(workspaceDiscussionClient, 'supportsAgentMessaging').mockResolvedValue(false);
    vi.spyOn(workspaceDiscussionClient, 'supportsAgentActivity').mockResolvedValue(false);
    vi.spyOn(workspaceDiscussionClient, 'supportsPrincipalMentions').mockResolvedValue(false);
    vi.spyOn(workspaceDiscussionClient, 'supportsManagement').mockResolvedValue(true);
    wire.readSetting.mockReset().mockResolvedValue({ value: true });
    wire.request.mockReset().mockResolvedValue({ messages: [], hasMore: false });
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    store.dispatch(replaceWorkspaceList([workspace(), workspace('other')]));
    store.dispatch(setLabsMultiplayerEnabled(true));
    admit();
    cancel = store.runSaga(workspaceDiscussionSaga);
  });
  afterEach(() => {
    cancel();
    dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function open() {
    store.dispatch(discussionRequested('ws'));
    await settle();
  }

  const activity = (
    state: DiscussionAgentActivity['state'] = 'working',
    version = 1,
    attempt = 1,
  ): DiscussionAgentActivity => ({
    agentId: 'agent-a',
    attempt,
    version,
    state,
    updatedAt: '2026-10-20T20:00:00Z',
    error: null,
  });
  const addressed = (a = activity()): DiscussionMessage => ({
    ...message(1),
    recipientAgentIds: ['agent-a'],
    agentActivity: [a],
    agentMentions: [],
  });
  function activityEvent(
    a: DiscussionAgentActivity,
    workspaceId = 'ws',
    messageId = 'server-1',
    subscriptionId = 'current',
  ) {
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId,
        event: {
          id: `activity-${a.version}`,
          type: 'discussion:activity',
          workspaceId,
          data: { workspaceId, conversationId: 'default', messageId, activity: a },
        },
      },
      ['current'],
    );
  }
  async function openActivity(a = activity()) {
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    wire.request.mockResolvedValueOnce({ messages: [addressed(a)], hasMore: false });
    await open();
  }
  it('merges activity arriving before history without letting older pages or attempts regress it', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    const first = deferred<{ messages: DiscussionMessage[]; hasMore: boolean }>();
    wire.request.mockReturnValueOnce(first.promise);
    await open();
    activityEvent(activity('working', 5, 2));
    activityEvent(activity('failed', 4, 1));
    first.resolve({ messages: [addressed(activity('queued', 1))], hasMore: false });
    await settle();
    expect(messages()[0].agentActivity).toEqual([activity('working', 5, 2)]);
    const target = selectDiscussionTarget.select(store.state, 'ws')!;
    store.dispatch(discussionMessageReceived(target, addressed(activity('failed', 3))));
    activityEvent(activity('stopped', 6, 1));
    activityEvent(activity('completed', 7, 2), 'ws', 'server-1', 'old');
    expect(messages()[0].agentActivity).toEqual([activity('working', 5, 2)]);
    expect(row().syncedSequence).toBe(1);
  });
  it('sends one exact Stop request and ignores its reply after a newer invocation event', async () => {
    await openActivity();
    const late = deferred<{ activity: DiscussionAgentActivity }>();
    wire.request.mockReturnValueOnce(late.promise);
    const stop = discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'stop');
    store.dispatch(stop);
    store.dispatch(stop);
    await settle();
    expect(wire.request.mock.calls.filter(([m]) => m === 'discussion.stopAgent')).toEqual([
      [
        'discussion.stopAgent',
        { workspaceId: 'ws', messageId: 'server-1', agentId: 'agent-a', attempt: 1 },
      ],
    ]);
    activityEvent(activity('queued', 4, 2));
    late.resolve({ activity: activity('stopped', 2) });
    await settle();
    expect(messages()[0].agentActivity).toEqual([activity('queued', 4, 2)]);
    wire.request.mockClear();
    store.dispatch(stop);
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(getItems(row().agentControls)).toHaveLength(0);
  });
  it('controls different recipients independently without cancelling the other invocation', async () => {
    await openActivity();
    const target = selectDiscussionTarget.select(store.state, 'ws')!;
    store.dispatch(
      discussionMessageReceived(target, {
        ...message(2),
        recipientAgentIds: ['agent-b'],
        agentMentions: [],
        agentActivity: [{ ...activity(), agentId: 'agent-b' }],
      }),
    );
    const first = deferred<{ activity: DiscussionAgentActivity }>();
    const second = deferred<{ activity: DiscussionAgentActivity }>();
    wire.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    store.dispatch(discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'stop'));
    store.dispatch(discussionAgentControlRequested('ws', 'server-2', 'agent-b', 1, 'stop'));
    await settle();
    expect(getItems(row().agentControls)).toHaveLength(2);
    first.resolve({ activity: activity('stopped', 2) });
    await settle();
    expect(getItems(row().agentControls).map((c) => c.agentId)).toEqual(['agent-b']);
    expect(messages()[1].agentActivity?.[0].state).toBe('working');
    second.resolve({ activity: { ...activity('stopped', 2), agentId: 'agent-b' } });
    await settle();
    expect(getItems(row().agentControls)).toHaveLength(0);
  });
  it('retries an uncertain control with the original attempt without resending the discussion message', async () => {
    await openActivity(activity('failed', 2));
    wire.request.mockRejectedValueOnce(new Error('connection lost'));
    const retry = discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'retry');
    store.dispatch(retry);
    await settle();
    expect(row().agentControlError).toBe('unknown');
    wire.request.mockResolvedValueOnce({ activity: activity('queued', 3, 2) });
    store.dispatch(retry);
    await settle();
    const calls = wire.request.mock.calls.filter(([method]) => method === 'discussion.retryAgent');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(messages()[0].agentActivity).toEqual([activity('queued', 3, 2)]);
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.send')).toBe(false);
    expect(row().agentControlError).toBeNull();
  });
  it('retains progress and draft after a mismatched control reply, then permits an identical retry', async () => {
    await openActivity(activity('failed', 2));
    store.dispatch(discussionDraftChanged('ws', 'Keep this unsent text'));
    wire.request.mockResolvedValueOnce({
      activity: { ...activity('queued', 3, 2), agentId: 'another-agent' },
    });
    const retry = discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'retry');
    store.dispatch(retry);
    await settle();
    expect(row()).toMatchObject({ draft: 'Keep this unsent text', agentControlError: 'unknown' });
    expect(getItems(row().agentControls)).toEqual([]);
    expect(messages()[0].agentActivity).toEqual([activity('failed', 2)]);
    wire.request.mockResolvedValueOnce({ activity: activity('queued', 3, 2) });
    store.dispatch(retry);
    await settle();
    expect(messages()[0].agentActivity).toEqual([activity('queued', 3, 2)]);
  });
  it.each(['identity', 'membership', 'backend'] as const)(
    'cancels late control success after %s changes',
    async (change) => {
      await openActivity(activity('failed', 2));
      const late = deferred<{ activity: DiscussionAgentActivity }>();
      wire.request.mockReturnValueOnce(late.promise);
      store.dispatch(discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'retry'));
      await settle();
      if (change === 'identity') admit('someone-else');
      else if (change === 'membership') store.dispatch(discussionMembershipInvalidated('ws'));
      else
        store.dispatch(
          connectionsListReceived({
            connections: [],
            activeId: 'remote',
            windowBackendId: 'remote',
          }),
        );
      await settle();
      late.resolve({ activity: activity('queued', 3, 2) });
      await settle();
      expect(messages().some((m) => m.agentActivity?.some((a) => a.attempt === 2))).toBe(false);
      expect(getItems(row().agentControls)).toHaveLength(0);
    },
  );
  it('restores terminal activity from cached-message metadata on reconnect without advancing history', async () => {
    await openActivity();
    wire.request.mockImplementation((method, params) => {
      if (method !== 'discussion.list') throw new Error('unexpected');
      return params.beforeSequence === 2
        ? { messages: [addressed(activity('completed', 3))], hasMore: false }
        : { messages: [], hasMore: false };
    });
    await reconnect();
    expect(messages()[0].agentActivity).toEqual([activity('completed', 3)]);
    expect(row().syncedSequence).toBe(1);
    expect(wire.request).toHaveBeenCalledWith('discussion.list', {
      workspaceId: 'ws',
      beforeSequence: 2,
      limit: 50,
    });
  });
  it('does not expose controls or consume activity on an unsupported daemon', async () => {
    await open();
    activityEvent(activity());
    store.dispatch(discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'stop'));
    await settle();
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.stopAgent')).toBe(
      false,
    );
    expect(getItems(row().activityUpdates)).toHaveLength(0);
  });

  it('persists sorted selected spans and retries their original payload after draft edits and a reconnect', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    await open();
    store.dispatch(discussionDraftChanged('ws', '😀 plain @Builder '));
    store.dispatch(discussionAgentSelected('ws', 'agent-b', 'Builder', 18, 18));
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0));
    const original = row().draft;
    const selected = row().agentMentions;
    expect(selected.map((m) => m.agentId)).toEqual(['agent-a', 'agent-b']);
    wire.request.mockRejectedValueOnce(new Error('lost acknowledgment'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const first = wire.request.mock.calls.find(([method]) => method === 'discussion.send')![1];
    expect(first).toMatchObject({
      body: original,
      agentMentions: selected,
      recipientAgentIds: ['agent-a', 'agent-b'],
    });
    store.dispatch(discussionDraftChanged('ws', 'Keep my new draft'));
    wire.request.mockResolvedValue({ messages: [], hasMore: false });
    await reconnect();
    wire.request.mockResolvedValueOnce({
      message: {
        ...message(1, 'ws', original),
        recipientAgentIds: first.recipientAgentIds,
        agentMentions: selected,
        agentActivity: [],
      },
    });
    store.dispatch(discussionRetryRequested('ws', first.messageId));
    await settle();
    const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
    expect(sends[1]).toEqual(sends[0]);
    expect(messages()[0].agentMentions).toEqual(selected);
    expect(row().draft).toBe('Keep my new draft');
    expect(pending()).toHaveLength(0);
  });
  it('sends selected people by identity and retries the original selection without consuming a newer draft', async () => {
    await open();
    store.dispatch(
      discussionPrincipalMentionsCapabilityReceived(
        selectDiscussionTarget.select(store.state, 'ws')!.context,
        true,
      ),
    );
    store.dispatch(discussionDraftChanged('ws', 'Hi '));
    store.dispatch(discussionPrincipalSelected('ws', 'alex-id', 'Alex', 3, 3));
    wire.request.mockRejectedValueOnce(new Error('lost acknowledgment'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const first = wire.request.mock.calls.find(([method]) => method === 'discussion.send')![1];
    expect(first).toEqual({
      workspaceId: 'ws',
      messageId: expect.any(String),
      body: 'Hi @Alex ',
      principalMentions: [{ principalId: 'alex-id', name: 'Alex', start: 3, end: 8 }],
    });
    store.dispatch(discussionDraftChanged('ws', 'Another thought '));
    store.dispatch(discussionPrincipalSelected('ws', 'jordan-id', 'Jordan', 16, 16));
    wire.request.mockResolvedValueOnce({
      message: {
        ...message(1, 'ws', 'Hi @Alex '),
        principalMentions: [{ principalId: 'alex-id', name: 'Alex', start: 3, end: 8 }],
      },
    });
    store.dispatch(discussionRetryRequested('ws', first.messageId));
    await settle();
    const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
    expect(sends[1]).toEqual(sends[0]);
    expect(messages()[0].principalMentions).toEqual([
      { principalId: 'alex-id', name: 'Alex', start: 3, end: 8 },
    ]);
    expect(row()).toMatchObject({
      draft: 'Another thought @Jordan ',
      principalMentions: [{ principalId: 'jordan-id', name: 'Jordan', start: 16, end: 23 }],
    });
    expect(pending()).toHaveLength(0);
  });
  it('does not silently drop a selected person when notification capability is lost', async () => {
    await open();
    const context = selectDiscussionTarget.select(store.state, 'ws')!.context;
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, true));
    store.dispatch(discussionPrincipalSelected('ws', 'alex-id', 'Alex', 0, 0));
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, false));
    wire.request.mockClear();
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(pending()[0]).toMatchObject({
      error: 'unsupported',
      sentPrincipalMentions: [{ principalId: 'alex-id', name: 'Alex', start: 0, end: 5 }],
    });
    expect(row().draft).toBe('@Alex ');
  });
  it('retains exact mention retry metadata when a reconnect loses the required capability', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    await open();
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0));
    wire.request.mockRejectedValueOnce(new Error('lost acknowledgment'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const original = pending()[0];
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(false);
    wire.request.mockResolvedValue({ messages: [], hasMore: false });
    await reconnect();
    wire.request.mockClear();
    store.dispatch(discussionRetryRequested('ws', original.id));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(pending()[0]).toMatchObject({
      id: original.id,
      sentAgentMentions: original.sentAgentMentions,
      error: 'unsupported',
    });
    expect(row().draft).toBe(original.body);
  });

  it('keeps explicit agent targets on retry while retaining a different new selection', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    await open();
    store.dispatch(discussionDraftChanged('ws', 'Review this '));
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 12, 12));
    wire.request.mockRejectedValueOnce(new Error('offline'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const first = wire.request.mock.calls.at(-1)!;
    expect(first).toEqual([
      'discussion.send',
      {
        workspaceId: 'ws',
        body: 'Review this @Reviewer ',
        messageId: expect.any(String),
        recipientAgentIds: ['agent-a'],
      },
    ]);
    const id = pending()[0].id;
    store.dispatch(discussionAgentRemoved('ws', 'agent-a'));
    store.dispatch(
      discussionAgentSelected('ws', 'agent-b', 'Builder', row().draft.length, row().draft.length),
    );
    const newDraft = row().draft;
    wire.request.mockResolvedValueOnce({
      message: { ...message(1, 'ws', first[1].body), recipientAgentIds: ['agent-a'] },
    });
    store.dispatch(discussionRetryRequested('ws', id));
    await settle();
    expect(wire.request.mock.calls.at(-1)).toEqual(first);
    expect(row().draft).toBe(newDraft);
    expect(row().agentMentions.map((m) => m.agentId)).toEqual(['agent-b']);
  });
  it('removing a target and retyping plain text uses a fresh retry key', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    await open();
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0));
    wire.request.mockRejectedValueOnce(new Error('offline'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const first = wire.request.mock.calls.at(-1)!;
    store.dispatch(discussionAgentRemoved('ws', 'agent-a'));
    store.dispatch(discussionDraftChanged('ws', first[1].body));
    wire.request.mockResolvedValueOnce({
      message: { ...message(1, 'ws', row().draft), recipientAgentIds: [] },
    });
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const next = wire.request.mock.calls.at(-1)!;
    expect(next[1].body).toBe(first[1].body);
    expect(next[1].messageId).not.toBe(first[1].messageId);
    expect(next[1]).not.toHaveProperty('recipientAgentIds');
  });
  it('blocks retained targets when the capability disappears without falling back to text', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    await open();
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0));
    store.dispatch(
      discussionAgentCapabilityReceived(store.state.workspaceDiscussion.context!, false),
    );
    wire.request.mockClear();
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(pending()[0]).toMatchObject({
      status: 'failed',
      error: 'unsupported',
      recipientAgentIds: ['agent-a'],
    });
    expect(row().draft).toBe('@Reviewer ');
    expect(row().unsupported).toBe(false);
  });
  it('counts an agent reply as unread and does not address its author automatically', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    wire.request.mockResolvedValueOnce({
      messages: [{ ...message(1), recipientAgentIds: [] }],
      hasMore: false,
    });
    await open();
    const target = selectDiscussionTarget.select(store.state, 'ws')!;
    store.dispatch(discussionReadThrough(target, 1));
    store.dispatch(
      discussionMessageReceived(target, {
        ...message(2),
        author: {
          principalId: null,
          agentId: 'agent-a',
          login: null,
          displayName: 'Reviewer',
          avatarUrl: null,
        },
        recipientAgentIds: [],
      }),
    );
    expect(selectDiscussionUnread.select(store.state, 'ws').count).toBe(1);
    store.dispatch(
      discussionDraftChanged('ws', 'Thanks @Reviewer intent://local/ws/agent/agent-a'),
    );
    wire.request.mockResolvedValueOnce({
      message: { ...message(3, 'ws', row().draft), recipientAgentIds: [] },
    });
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request.mock.calls.at(-1)![1]).not.toHaveProperty('recipientAgentIds');
  });

  it('merges live delivery during list and loads older pages once per request', async () => {
    const first = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page(1, 1));
    store.dispatch(discussionRequested('ws'));
    await settle();
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(4)),
    );
    first.resolve(page(2, 3, true));
    await settle();
    expect(messages().map((m) => m.sequence)).toEqual([2, 3, 4]);
    store.dispatch(discussionOlderRequested('ws'));
    await settle();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.list', {
      workspaceId: 'ws',
      beforeSequence: 2,
      limit: 50,
    });
    expect(messages().map((m) => m.sequence)).toEqual([1, 2, 3, 4]);
    expect(row().hasMore).toBe(false);
  });
  it('waits for admission and subscription before loading an already mounted pane', async () => {
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
    expect(wire.request).toHaveBeenCalledWith(
      'discussion.list',
      expect.objectContaining({ workspaceId: 'ws' }),
    );
  });
  it('deduplicates echo-before-reply and preserves edits made while sending', async () => {
    await open();
    const send = deferred<{ message: DiscussionMessage }>();
    wire.request.mockReturnValueOnce(send.promise);
    store.dispatch(discussionDraftChanged('ws', 'hello'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(pending()).toHaveLength(1);
    store.dispatch(discussionDraftChanged('ws', 'next draft'));
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(1)),
    );
    send.resolve({ message: message(1) });
    await settle();
    expect(messages()).toEqual([message(1)]);
    expect(pending()).toEqual([]);
    expect(row().draft).toBe('next draft');
  });
  it('retains the failed body and retries with exactly the same client key', async () => {
    await open();
    wire.request
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ message: message(1) });
    store.dispatch(discussionDraftChanged('ws', 'hello'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const retry = pending()[0];
    expect(retry).toMatchObject({ body: 'hello', status: 'failed' });
    expect(row().draft).toBe('hello');
    store.dispatch(discussionRetryRequested('ws', retry.id));
    await settle();
    const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
    expect(sends[0][1]).toEqual(sends[1][1]);
    expect(pending()).toEqual([]);
    expect(row().draft).toBe('');
  });
  async function reconnect() {
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
  }
  it('recovers forward from synchronized history and retains drafts', async () => {
    wire.request.mockResolvedValueOnce(page(1, 2));
    await open();
    store.dispatch(discussionDraftChanged('ws', 'unsent'));
    wire.request.mockResolvedValueOnce(page(3, 52, true)).mockResolvedValueOnce(page(53, 102));
    await reconnect();
    expect(messages()).toHaveLength(102);
    expect(row()).toMatchObject({ draft: 'unsent', syncedSequence: 102, catchUp: false });
    expect(wire.request.mock.calls.map(([, params]) => params.afterSequence)).toEqual([
      undefined,
      2,
      52,
    ]);
  });
  it('bounds a long catch-up at 500 messages and resumes its cursor on explicit retry', async () => {
    wire.request.mockResolvedValueOnce(page(1, 1));
    await open();
    wire.request.mockImplementation(async (_method, params) => {
      const start = params.afterSequence + 1;
      return page(start, Math.min(551, start + 49), start + 49 < 551);
    });
    await reconnect();
    expect(wire.request).toHaveBeenCalledTimes(11);
    expect(row()).toMatchObject({
      loading: false,
      error: 'unknown',
      catchUp: true,
      syncedSequence: 501,
    });
    expect(messages().map((m) => m.sequence)).toEqual(Array.from({ length: 501 }, (_, i) => i + 1));
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.list', {
      workspaceId: 'ws',
      afterSequence: 501,
      limit: 50,
    });
    expect(row()).toMatchObject({ catchUp: false, syncedSequence: 551, error: null });
    expect(messages()).toHaveLength(551);
  });
  it('resumes each completed page across repeated reconnects and rejects cancelled late pages', async () => {
    wire.request.mockResolvedValueOnce(page(1, 1));
    await open();
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    wire.request.mockResolvedValueOnce(page(2, 51, true)).mockReturnValueOnce(first.promise);
    await reconnect();
    expect(row().syncedSequence).toBe(51);
    wire.request.mockResolvedValueOnce(page(52, 101, true)).mockReturnValueOnce(second.promise);
    await reconnect();
    expect(row().syncedSequence).toBe(101);
    wire.request.mockResolvedValueOnce(page(102, 151));
    await reconnect();
    first.resolve(page(52, 101, true));
    second.resolve(page(102, 151, true));
    await settle();
    expect(wire.request.mock.calls.map(([, params]) => params.afterSequence)).toEqual([
      undefined,
      1,
      51,
      51,
      101,
      101,
    ]);
    expect(row()).toMatchObject({ syncedSequence: 151, loading: false, catchUp: false });
    expect(messages()).toHaveLength(151);
  });
  it('does not skip history when live messages arrive before the first read completes', async () => {
    const first = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(first.promise);
    await open();
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(100)),
    );
    first.resolve(page(1, 2));
    await settle();
    expect(row().syncedSequence).toBe(2);
    const recovery = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(recovery.promise).mockResolvedValueOnce(page(53, 100));
    await reconnect();
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(101)),
    );
    recovery.resolve(page(3, 52, true));
    await settle();
    expect(wire.request.mock.calls.map(([, params]) => params.afterSequence)).toEqual([
      undefined,
      2,
      52,
    ]);
    expect(messages()).toHaveLength(101);
    expect(row().syncedSequence).toBe(100);
  });
  it('recovers from zero after an empty initial history, allowing gaps in the sequence', async () => {
    await open();
    expect(row().syncedSequence).toBe(0);
    wire.request
      .mockResolvedValueOnce({ messages: [message(5), message(9)], hasMore: true })
      .mockResolvedValueOnce({ messages: [message(100)], hasMore: false });
    await reconnect();
    expect(wire.request.mock.calls.map(([, params]) => params.afterSequence)).toEqual([
      undefined,
      0,
      9,
    ]);
    expect(messages().map((m) => m.sequence)).toEqual([5, 9, 100]);
    expect(row().syncedSequence).toBe(100);
  });
  it.each([
    { messages: [], hasMore: true },
    { messages: [message(20)], hasMore: true },
    { messages: [message(20)], hasMore: false },
    { messages: [message(19), message(21)], hasMore: true },
  ])(
    'stops invalid/nonadvancing forward pages and retries from the unchanged cursor',
    async (invalid) => {
      wire.request.mockResolvedValueOnce(page(20, 20, true));
      await open();
      wire.request.mockResolvedValueOnce(invalid);
      await reconnect();
      expect(wire.request).toHaveBeenCalledTimes(2);
      expect(row()).toMatchObject({
        syncedSequence: 20,
        catchUp: true,
        loading: false,
        error: 'unknown',
        beforeSequence: 20,
        hasMore: true,
      });
      expect(messages()).toEqual([message(20)]);
      wire.request.mockResolvedValueOnce(page(21, 21));
      store.dispatch(discussionRequested('ws'));
      await settle();
      expect(wire.request).toHaveBeenLastCalledWith('discussion.list', {
        workspaceId: 'ws',
        afterSequence: 20,
        limit: 50,
      });
      expect(row()).toMatchObject({ syncedSequence: 21, catchUp: false, error: null });
    },
  );
  it('keeps late older history and echoes separate from the recovery cursor', async () => {
    wire.request.mockResolvedValueOnce(page(10, 20, true));
    await open();
    const older = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(older.promise);
    store.dispatch(discussionOlderRequested('ws'));
    await settle();
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(50)),
    );
    older.resolve(page(1, 9));
    await settle();
    wire.request.mockResolvedValueOnce(page(21, 50));
    await reconnect();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.list', {
      workspaceId: 'ws',
      afterSequence: 20,
      limit: 50,
    });
    expect(messages()).toHaveLength(50);
    expect(row()).toMatchObject({ syncedSequence: 50, beforeSequence: 1, hasMore: false });
  });
  it('ignores a cancelled older page after forward recovery and can still load that history', async () => {
    wire.request.mockResolvedValueOnce(page(10, 20, true));
    await open();
    const older = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(older.promise);
    store.dispatch(discussionOlderRequested('ws'));
    await settle();
    wire.request.mockResolvedValueOnce(page(21, 50));
    await reconnect();
    older.resolve(page(1, 9));
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(50)),
    );
    await settle();
    expect(messages()).toHaveLength(41);
    expect(row()).toMatchObject({ syncedSequence: 50, beforeSequence: 10, hasMore: true });
    wire.request.mockResolvedValueOnce(page(1, 9));
    store.dispatch(discussionOlderRequested('ws'));
    await settle();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.list', {
      workspaceId: 'ws',
      beforeSequence: 10,
      limit: 50,
    });
    expect(messages()).toHaveLength(50);
    expect(row()).toMatchObject({ syncedSequence: 50, beforeSequence: 1, hasMore: false });
  });
  it('preserves the retry body after InvalidParams even when the user edits the draft', async () => {
    await open();
    wire.request
      .mockRejectedValueOnce({ rpcCode: -32602, data: { code: 'invalid-params' } })
      .mockResolvedValueOnce({ message: message(1) });
    store.dispatch(discussionDraftChanged('ws', 'hello'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(row()).toMatchObject({ sending: false, sendError: 'invalid', draft: 'hello' });
    const id = pending()[0].id;
    store.dispatch(discussionDraftChanged('ws', 'changed body'));
    store.dispatch(discussionRetryRequested('ws', id));
    await settle();
    const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
    expect(sends[1][1]).toEqual(sends[0][1]);
    expect(row().draft).toBe('changed body');
    expect(pending()).toEqual([]);
  });
  it.each([
    { message: { ...message(1), body: 'wrong body' } },
    { message: message(1, 'other') },
    { message: null },
    null,
  ])(
    'retains the original send after malformed success and retries identical parameters',
    async (invalid) => {
      await open();
      wire.request.mockResolvedValueOnce(invalid).mockResolvedValueOnce({ message: message(1) });
      store.dispatch(discussionDraftChanged('ws', 'hello'));
      store.dispatch(discussionSendRequested('ws'));
      await settle();
      expect(row()).toMatchObject({ draft: 'hello', sending: false, sendError: 'unknown' });
      const retry = pending()[0];
      expect(retry).toMatchObject({ body: 'hello', status: 'failed' });
      store.dispatch(discussionDraftChanged('ws', 'new draft'));
      store.dispatch(discussionRetryRequested('ws', retry.id));
      await settle();
      const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
      expect(sends[1][1]).toEqual(sends[0][1]);
      expect(row()).toMatchObject({ draft: 'new draft', sending: false, sendError: null });
      expect(pending()).toEqual([]);
      expect(messages()).toEqual([message(1)]);
    },
  );
  it.each(['identity', 'backend', 'workspace'] as const)(
    'drops delayed replies after a %s change',
    async (change) => {
      const late = deferred<ReturnType<typeof page>>();
      wire.request
        .mockReturnValueOnce(late.promise)
        .mockResolvedValue({ messages: [], hasMore: false });
      store.dispatch(discussionRequested('ws'));
      await settle();
      if (change === 'identity') admit('someone-else');
      if (change === 'backend') {
        store.dispatch(
          connectionsListReceived({
            connections: [],
            activeId: 'remote',
            windowBackendId: 'remote',
          }),
        );
        admit();
      }
      if (change === 'workspace') {
        store.dispatch(replaceWorkspaceList([workspace('other')]));
        await settle();
        store.dispatch(replaceWorkspaceList([workspace(), workspace('other')]));
        await settle();
        store.dispatch(discussionRequested('ws'));
      }
      await settle();
      late.resolve(page(1, 2));
      await settle();
      expect(messages()).toEqual([]);
    },
  );
  it.each([
    [-32601, 'unsupported'],
    [-32003, 'forbidden'],
  ] as const)('exposes old daemon error %s without dropping drafts', async (rpcCode, error) => {
    await open();
    store.dispatch(discussionDraftChanged('ws', 'keep this'));
    wire.request.mockRejectedValueOnce({ rpcCode });
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(row()).toMatchObject({
      error,
      unsupported: error === 'unsupported',
      draft: 'keep this',
      loading: false,
    });
  });
  it('rejects malformed or cross-workspace list data', async () => {
    wire.request.mockResolvedValueOnce({ messages: [message(1, 'other')], hasMore: false });
    await open();
    expect(messages()).toEqual([]);
    expect(row().error).toBe('unknown');
  });
  it('routes valid discussion events through the admitted subscription without adding activity', async () => {
    await open();
    const activity = store.state.workspaceEvents.byWorkspaceId.ws;
    const emit = (data: unknown, subscriptionId = 'current', envelope = 'ws') =>
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId,
          event: { id: 'event-1', type: 'discussion:message', workspaceId: envelope, data },
        },
        ['current'],
      );
    emit({ workspaceId: 'ws', message: message(1) }, 'old');
    emit({ workspaceId: 'other', message: message(1) });
    emit({ workspaceId: 'ws', message: message(1) }, 'current', 'other');
    expect(messages()).toEqual([]);
    emit({ workspaceId: 'ws', message: message(1) });
    emit({ workspaceId: 'ws', message: message(1) });
    expect(messages()).toEqual([message(1)]);
    expect(store.state.workspaceEvents.byWorkspaceId.ws).toBe(activity);
    store.dispatch(connectionStatusChanged('disconnected'));
    emit({ workspaceId: 'ws', message: message(2) });
    expect(messages()).toEqual([message(1)]);
  });
  it('reopens a removed workspace while the old list is still unresolved', async () => {
    const old = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(5, 5));
    await open();
    store.dispatch(replaceWorkspaceList([workspace('other')]));
    await settle();
    store.dispatch(replaceWorkspaceList([workspace(), workspace('other')]));
    await settle();
    await open();
    expect(messages()).toEqual([message(5)]);
    old.resolve(page(1, 2));
    await settle();
    expect(messages()).toEqual([message(5)]);
  });
  it('keeps an uncertain send key across reconnect and ignores the old acknowledgement', async () => {
    await open();
    const old = deferred<{ message: DiscussionMessage }>();
    wire.request.mockReturnValueOnce(old.promise);
    store.dispatch(discussionDraftChanged('ws', 'hello'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const id = pending()[0].id;
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    wire.request.mockResolvedValueOnce(page(1, 1)).mockResolvedValueOnce({ message: message(1) });
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
    old.resolve({ message: message(2) });
    await settle();
    expect(pending()[0]).toMatchObject({ id, status: 'failed' });
    expect(messages()).toEqual([message(1)]);
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.send', {
      workspaceId: 'ws',
      messageId: id,
      body: 'hello',
    });
    expect(messages()).toEqual([message(1)]);
    expect(pending()).toEqual([]);
  });
  it('initial live traffic does not hide the older-history cursor', async () => {
    await open();
    store.dispatch(replaceWorkspaceList([workspace('other')]));
    await settle();
    store.dispatch(replaceWorkspaceList([workspace(), workspace('other')]));
    await settle();
    const result = deferred<ReturnType<typeof page>>();
    wire.request.mockReturnValueOnce(result.promise);
    store.dispatch(discussionRequested('ws'));
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, message(60)),
    );
    result.resolve(page(10, 59, true));
    await settle();
    expect(row()).toMatchObject({ beforeSequence: 10, hasMore: true });
    expect(messages().at(-1)?.sequence).toBe(60);
  });
  it('rejects oversized UTF-8 bodies locally and preserves the draft', async () => {
    await open();
    const body = '🌈'.repeat(4097);
    store.dispatch(discussionDraftChanged('ws', body));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request.mock.calls.filter(([method]) => method === 'discussion.send')).toEqual([]);
    expect(row()).toMatchObject({ draft: body, sendError: 'invalid', sending: false });
  });
  it('treats an inaccessible workspace result as denied without retrying another method', async () => {
    wire.request.mockRejectedValueOnce({ rpcCode: -32602, data: { code: 'not-found' } });
    await open();
    expect(row().error).toBe('forbidden');
    expect(wire.request).toHaveBeenCalledTimes(1);
  });
  it('admits the first pane before its row exists, so ready-driven mounting starts a load', async () => {
    expect(store.state.workspaceDiscussion.byWorkspaceId.ws).toBeUndefined();
    expect(selectDiscussionReady.select(store.state, 'ws')).toBe(true);
    expect(selectDiscussionReady.select(store.state, 'missing')).toBe(false);
    wire.request.mockResolvedValueOnce(page(1, 1));
    if (selectDiscussionReady.select(store.state, 'ws')) store.dispatch(discussionRequested('ws'));
    await settle();
    expect(row().initialized).toBe(true);
    expect(messages()).toEqual([message(1)]);
    expect(selectDiscussionReady.select(store.state, 'ws', 'new')).toBe(true);
  });
  it('keeps draft and history visible during reconnect admission while sending stays disabled', async () => {
    wire.request.mockResolvedValueOnce(page(1, 1));
    await open();
    store.dispatch(discussionDraftChanged('ws', 'unsent draft'));
    store.dispatch(connectionStatusChanged('disconnected'));
    // Match principalSaga, which drops the authoritative snapshot on disconnect.
    store.dispatch(principalContextChanged(null));
    await settle();
    expect(messages()).toEqual([message(1)]);
    expect(row().draft).toBe('unsent draft');
    expect(selectDiscussionReady.select(store.state, 'ws')).toBe(false);
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request.mock.calls.filter(([m]) => m === 'discussion.send')).toEqual([]);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    store.dispatch(principalContextChanged(selectPrincipalConnectionContext.select(store.state)));
    await settle();
    expect(messages()).toEqual([message(1)]);
    expect(row().draft).toBe('unsent draft');
    expect(selectDiscussionReady.select(store.state, 'ws')).toBe(false);
    wire.request.mockResolvedValueOnce(page(2, 2));
    admit();
    await settle();
    expect(messages()).toEqual([message(1), message(2)]);
    expect(row().draft).toBe('unsent draft');
    expect(selectDiscussionReady.select(store.state, 'ws')).toBe(true);
  });
  it.each(['identity', 'backend', 'denial'] as const)(
    'withholds reconnect cache immediately on %s change',
    async (change) => {
      wire.request.mockResolvedValueOnce(page(1, 1));
      await open();
      store.dispatch(discussionDraftChanged('ws', 'private draft'));
      store.dispatch(connectionStatusChanged('disconnected'));
      store.dispatch(principalContextChanged(null));
      await settle();
      expect(row().draft).toBe('private draft');
      if (change === 'identity') {
        store.dispatch(connectionStatusChanged('connected'));
        store.dispatch(daemonEventsSubscribed());
        admit('different-person');
      } else if (change === 'backend') {
        store.dispatch(
          connectionsListReceived({
            connections: [],
            activeId: 'another',
            windowBackendId: 'another',
          }),
        );
      } else {
        store.dispatch(
          authRejectedReceived({ id: 'local' } as Parameters<typeof authRejectedReceived>[0]),
        );
      }
      expect(messages()).toEqual([]);
      expect(row().draft).toBe('');
      await settle();
      expect(row().draft).toBe('');
    },
  );
  const author = (principalId: string) => ({
    principalId,
    login: null,
    displayName: null,
    avatarUrl: null,
  });
  const conversation = (id: string) => ({
    id,
    workspaceId: 'ws',
    kind: 'direct' as const,
    participants: [author('me'), author('other')],
    createdAt: '2026-10-16T00:00:00Z',
  });
  const privateMessage = (id: string, sequence = 1) => ({
    ...message(sequence),
    id: `${id}-${sequence}`,
    conversationId: id,
  });
  function multiWire() {
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'system.capabilities') return { discussionConversations: 1 };
      if (method === 'discussion.conversations')
        return { conversations: [conversation('c2'), conversation('c1')], hasMore: false };
      if (method === 'discussion.recipients') return { members: [author('other')], hasMore: false };
      if (method === 'discussion.list')
        return params.conversationId
          ? {
              messages: [privateMessage(params.conversationId)],
              hasMore: false,
              conversation: conversation(params.conversationId),
            }
          : { messages: [], hasMore: false };
      if (method === 'discussion.send')
        return {
          message: { ...privateMessage(params.conversationId ?? 'created'), body: params.body },
          conversation: params.createConversation
            ? { ...conversation('created'), kind: 'workspace', participants: [] }
            : conversation(params.conversationId ?? 'created'),
        };
      throw new Error(`Unexpected ${method}`);
    });
  }
  async function openNew() {
    store.dispatch(discussionRequested('ws', 'new'));
    await settle();
    store.dispatch(discussionDraftChanged('ws', 'hello', 'new'));
  }
  it('isolates overlapping sequences, drafts and default legacy events across conversations', async () => {
    multiWire();
    store.dispatch(discussionRequested('ws', 'c1'));
    store.dispatch(discussionRequested('ws', 'c2'));
    await open();
    store.dispatch(discussionDraftChanged('ws', 'private one', 'c1'));
    store.dispatch(discussionDraftChanged('ws', 'private two', 'c2'));
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId: 'current',
        event: {
          id: 'e7',
          type: 'discussion:message',
          workspaceId: 'ws',
          data: { workspaceId: 'ws', message: message(7) },
        },
      },
      ['current'],
    );
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1').map((m) => m.id)).toEqual([
      'c1-1',
    ]);
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c2').map((m) => m.id)).toEqual([
      'c2-1',
    ]);
    expect(messages().map((m) => m.sequence)).toEqual([7]);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c1').draft).toBe('private one');
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c2').draft).toBe('private two');
  });
  it('keeps an uncertain create immutable, then promotes its exact retry without losing new edits', async () => {
    multiWire();
    await openNew();
    const normal = wire.request.getMockImplementation()!;
    let fail = true;
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'discussion.send' && fail) throw new Error('lost acknowledgement');
      return normal(method, params);
    });
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    const failed = selectDiscussionPending.select(store.state, 'ws', 'new')[0];
    expect(failed.recipientPrincipalIds).toBeUndefined();
    expect(
      wire.request.mock.calls.find(([method]) => method === 'discussion.send')?.[1],
    ).toMatchObject({ createConversation: true });
    store.dispatch(discussionRecipientsChanged('ws', []));
    store.dispatch(discussionDraftChanged('ws', 'next message', 'new'));
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    expect(wire.request.mock.calls.filter((c) => c[0] === 'discussion.send')).toHaveLength(1);
    fail = false;
    store.dispatch(discussionRetryRequested('ws', failed.id, 'new'));
    await settle();
    const sends = wire.request.mock.calls.filter((c) => c[0] === 'discussion.send');
    expect(sends[1][1]).toEqual(sends[0][1]);
    expect(selectDiscussionCreatedId.select(store.state, 'ws')).toBe('created');
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'created').draft).toBe(
      'next message',
    );
    expect(selectDiscussionPending.select(store.state, 'ws', 'created')).toEqual([]);
    store.dispatch(discussionNewRequested('ws'));
    expect(selectDiscussionCreatedId.select(store.state, 'ws')).toBeNull();
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'created').draft).toBe(
      'next message',
    );
  });
  it('does not fall back to default when an old daemon ignores new parameters', async () => {
    vi.mocked(workspaceDiscussionClient.supportsManagement).mockResolvedValue(false);
    store.dispatch(
      discussionManagementCapabilityReceived(
        selectPrincipalActionContext.select(store.state)!,
        false,
      ),
    );
    wire.request.mockResolvedValue({ messages: [], hasMore: false });
    await openNew();
    store.dispatch(discussionSendRequested('ws', 'new'));
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    expect(selectDiscussionCanCreate.select(store.state, 'ws')).toBe(false);
    expect(wire.request.mock.calls.every((c) => c[0] === 'system.capabilities')).toBe(true);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'new').draft).toBe('hello');
  });
  it('discovers a recipient conversation from its event and merges a late directory page', async () => {
    multiWire();
    await openNew();
    const pendingDirectory = deferred<{
      conversations: ReturnType<typeof conversation>[];
      hasMore: boolean;
    }>();
    const normal = wire.request.getMockImplementation()!;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.conversations' ? pendingDirectory.promise : normal(method, params),
    );
    store.dispatch(discussionDirectoryRequested('ws'));
    await settle();
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId: 'current',
        event: {
          id: 'e3',
          type: 'discussion:message',
          workspaceId: 'ws',
          data: {
            workspaceId: 'ws',
            conversationId: 'c3',
            conversation: conversation('c3'),
            message: privateMessage('c3'),
          },
        },
      },
      ['current'],
    );
    pendingDirectory.resolve({ conversations: [conversation('c2')], hasMore: false });
    await settle();
    expect(selectDiscussionConversations.select(store.state, 'ws').map((c) => c.id)).toEqual([
      'c3',
      'c2',
    ]);
  });
  it('counts unopened live mentions without accepting malformed metadata or nonparticipant events', async () => {
    multiWire();
    await openNew();
    const context = selectDiscussionTarget.select(store.state, 'ws', 'new')!.context;
    store.dispatch(discussionPrincipalMentionsCapabilityReceived(context, true));
    const incoming = {
      ...privateMessage('unopened', 12),
      author: author('other'),
      body: 'Hi @Sam',
      principalMentions: [{ principalId: 'me', name: 'Sam', start: 3, end: 7 }],
    };
    const emit = (participants = conversation('unopened').participants, start = 3) =>
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId: 'current',
          event: {
            id: 'live-person-mention',
            type: 'discussion:message',
            workspaceId: 'ws',
            data: {
              workspaceId: 'ws',
              conversationId: 'unopened',
              conversation: { ...conversation('unopened'), participants },
              message: {
                ...incoming,
                principalMentions: [{ ...incoming.principalMentions[0], start }],
              },
            },
          },
        },
        ['current'],
      );
    emit([author('other')]);
    emit(undefined, 0);
    expect(selectDiscussionTarget.select(store.state, 'ws', 'unopened')).toBeNull();
    emit();
    emit();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'unopened')).toEqual([incoming]);
    expect(selectDiscussionUnread.select(store.state, 'ws', 'unopened')).toEqual({
      count: 1,
      firstSequence: 12,
    });
    store.dispatch(discussionMembershipInvalidated('ws'));
    expect(selectDiscussionUnread.select(store.state, 'ws', 'unopened').count).toBe(0);
  });
  it('searches mention candidates and ignores late query replies', async () => {
    multiWire();
    await openNew();
    const late = deferred<{ members: ReturnType<typeof author>[]; hasMore: boolean }>();
    const normal = wire.request.getMockImplementation()!;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.recipients'
        ? params.query === 'old'
          ? late.promise
          : Promise.resolve({ members: [author('new')], hasMore: false })
        : normal(method, params),
    );
    store.dispatch(discussionRecipientsRequested('ws', 'old'));
    store.dispatch(discussionRecipientsRequested('ws', 'new'));
    await settle();
    late.resolve({ members: [author('stale')], hasMore: false });
    await settle();
    const recipients = selectDiscussionRecipients.select(store.state, 'ws');
    expect(recipients.query).toBe('new');
    expect(recipients.members.map((m) => m.principalId)).toEqual(['new']);
    expect(recipients.selectedMembers).toEqual([]);
  });
  it('hides private cached history during reauthorization and discards it after access denial', async () => {
    multiWire();
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    store.dispatch(discussionDraftChanged('ws', 'private draft', 'c1'));
    const late = deferred<never>();
    const normal = wire.request.getMockImplementation()!;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.list' ? late.promise : normal(method, params),
    );
    store.dispatch(discussionMembershipInvalidated('ws'));
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1')).toEqual([]);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c1').draft).toBe('');
    late.reject({ rpcCode: -32602, data: { code: 'not-found' } });
    await settle();
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c1')).toMatchObject({
      error: 'forbidden',
      draft: '',
      sending: false,
    });
    expect(store.state.workspaceDiscussion.byWorkspaceId.ws.c1.draft).toBe('');
  });
  it('keeps initialized private history visible while the same owner is offline', async () => {
    multiWire();
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    store.dispatch(discussionDraftChanged('ws', 'private draft', 'c1'));
    store.dispatch(connectionStatusChanged('disconnected'));
    store.dispatch(principalContextChanged(null));
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1')).toEqual([
      privateMessage('c1'),
    ]);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c1').draft).toBe('private draft');
    expect(selectDiscussionReady.select(store.state, 'ws', 'c1')).toBe(false);
  });
  it('promotes a closed composer before a fresh composer opens, so restore keeps the created thread', async () => {
    multiWire();
    await openNew();
    store.dispatch(
      initializeLayout('layout', {
        root: { type: 'panel', panelId: 'p' },
        panels: {
          p: {
            id: 'p',
            activeTabId: 'new-tab',
            tabs: [
              {
                id: 'new-tab',
                type: 'discussion',
                title: 'New',
                workspaceId: 'ws',
                data: { conversationId: 'new' },
              },
              { id: 'other', type: 'note', title: 'Note' },
            ],
          },
        },
        focusedPanelId: 'p',
      }),
    );
    const reply = deferred<{
      message: ReturnType<typeof privateMessage>;
      conversation: DiscussionConversation;
    }>();
    const normal = wire.request.getMockImplementation()!;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.send' ? reply.promise : normal(method, params),
    );
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    store.dispatch(closeTab('layout', 'new-tab'));
    reply.resolve({
      message: privateMessage('created'),
      conversation: { ...conversation('created'), kind: 'workspace', participants: [] },
    });
    await settle();
    expect(
      store.state.panelLayout.byWorkspaceId.layout.recentlyClosed[0].tab.data?.conversationId,
    ).toBe('created');
    store.dispatch(discussionNewRequested('ws'));
    store.dispatch(reopenClosedTab('layout'));
    const restored = Object.values(store.state.panelLayout.byWorkspaceId.layout.panels)
      .flatMap((p) => p.tabs)
      .find((t) => t.type === 'discussion');
    expect(restored?.data?.conversationId).toBe('created');
  });
  it('retains authorized history and drafts when the remaining member is alone', async () => {
    multiWire();
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    store.dispatch(discussionDraftChanged('ws', 'retained', 'c1'));
    store.dispatch(replaceWorkspaceList([{ ...workspace(), memberCount: 1 }]));
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1')).toHaveLength(1);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'c1').draft).toBe('retained');
    expect(selectDiscussionReady.select(store.state, 'ws', 'c1')).toBe(true);
  });
  it('allows correcting a definitively rejected first message without reusing its key', async () => {
    multiWire();
    await openNew();
    const normal = wire.request.getMockImplementation()!;
    let fail = true;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.send' && fail
        ? Promise.reject({ rpcCode: -32602, data: { code: 'invalid-params' } })
        : normal(method, params),
    );
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'new')).toMatchObject({
      draft: 'hello',
      recipientsLocked: false,
      sending: false,
      sendError: 'invalid',
    });
    fail = false;
    store.dispatch(discussionDraftChanged('ws', 'corrected', 'new'));
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    const sends = wire.request.mock.calls.filter((c) => c[0] === 'discussion.send');
    expect(sends[1][1].messageId).not.toBe(sends[0][1].messageId);
    expect(selectDiscussionCreatedId.select(store.state, 'ws')).toBe('created');
  });
  it('cancels an in-flight private read on membership invalidation and admits only its replacement', async () => {
    multiWire();
    const late = deferred<{
      messages: ReturnType<typeof privateMessage>[];
      conversation: ReturnType<typeof conversation>;
      hasMore: boolean;
    }>();
    const normal = wire.request.getMockImplementation()!;
    let reads = 0;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.list' && ++reads === 1 ? late.promise : normal(method, params),
    );
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    store.dispatch(discussionMembershipInvalidated('ws'));
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1').map((m) => m.id)).toEqual([
      'c1-1',
    ]);
    late.resolve({
      messages: [privateMessage('c1', 999)],
      conversation: conversation('c1'),
      hasMore: false,
    });
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1').map((m) => m.id)).toEqual([
      'c1-1',
    ]);
  });
  const withActions = (row: DiscussionMessage): DiscussionMessage => ({
    ...row,
    replyToMessageId: null,
    replyTo: null,
    reactions: [],
    reactionVersion: 0,
  });
  it('keeps unread counts per thread through remount and reconnect, excluding own sends and older history', async () => {
    wire.request.mockResolvedValue({ messages: [message(10)], hasMore: true });
    await open();
    const target = selectDiscussionTarget.select(store.state, 'ws')!;
    store.dispatch(
      discussionMessageReceived(target, {
        ...message(20),
        author: { ...message(20).author, principalId: 'other' },
      }),
    );
    store.dispatch(discussionMessageReceived(target, message(30)));
    expect(selectDiscussionUnread.select(store.state, 'ws')).toEqual({
      count: 1,
      firstSequence: 20,
    });
    wire.request.mockResolvedValue({ messages: [], hasMore: false });
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(selectDiscussionUnread.select(store.state, 'ws').count).toBe(1);
    store.dispatch(discussionReadThrough({ ...target, epoch: target.epoch + 1 }, 20));
    store.dispatch(discussionReadThrough(target, 999));
    expect(selectDiscussionUnread.select(store.state, 'ws').count).toBe(1);
    store.dispatch(discussionReadThrough(target, 20));
    expect(selectDiscussionUnread.select(store.state, 'ws').count).toBe(0);
    expect(row().readSequence).toBe(20);
    store.dispatch(discussionReadThrough(target, 10));
    expect(row().readSequence).toBe(20);
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    expect(row().readSequence).toBe(20);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit('someone-else');
    await settle();
    expect(row().readSequence).not.toBe(20);
  });
  it('retains pending author, timestamp, body, and reply target across uncertain retries and deduplicates acknowledgement', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    const original = withActions(message(1));
    wire.request.mockResolvedValue({ messages: [original], hasMore: false });
    await open();
    store.dispatch(discussionReplySelected('ws', original.id));
    store.dispatch(discussionDraftChanged('ws', 'a reply'));
    wire.request.mockRejectedValueOnce(new Error('lost ack'));
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    const failed = pending()[0];
    expect(failed).toMatchObject({
      body: 'a reply',
      author: { principalId: 'me' },
      replyToMessageId: 'server-1',
      status: 'failed',
    });
    expect(Number.isFinite(Date.parse(failed.createdAt!))).toBe(true);
    store.dispatch(discussionReplySelected('ws', null));
    store.dispatch(discussionDraftChanged('ws', 'different draft'));
    const reply = {
      ...withActions(message(2, 'ws', 'a reply')),
      replyToMessageId: 'server-1',
      replyTo: { id: 'server-1', author: original.author, body: original.body },
    };
    wire.request.mockResolvedValue({ message: reply });
    store.dispatch(
      discussionMessageReceived(selectDiscussionTarget.select(store.state, 'ws')!, reply),
    );
    store.dispatch(discussionRetryRequested('ws', failed.id));
    await settle();
    const sends = wire.request.mock.calls.filter(([method]) => method === 'discussion.send');
    expect(sends[1][1]).toEqual(sends[0][1]);
    expect(sends[0][1]).toMatchObject({ replyToMessageId: 'server-1' });
    expect(messages().filter((m) => m.id === reply.id)).toHaveLength(1);
    expect(pending()).toEqual([]);
    expect(row().draft).toBe('different draft');
    expect(row().replyToMessageId).toBeNull();
  });
  it('gates expanded mutations independently and retains confirmed state when a mutation fails', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    wire.request.mockResolvedValue({ messages: [withActions(message(1))], hasMore: false });
    await open();
    wire.request.mockClear();
    store.dispatch(discussionReactionRequested('ws', 'server-1', '👀'));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    vi.mocked(workspaceDiscussionClient.supportsReactions).mockResolvedValue(true);
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    wire.request.mockImplementation((_method, params) => ({
      messages: params.afterSequence ? [] : [withActions(message(1))],
      hasMore: false,
    }));
    await settle();
    wire.request.mockResolvedValue({
      messageId: 'server-1',
      reactionVersion: 1,
      reactions: [{ reaction: '👀', count: 1, reacted: true, reactors: [message(1).author] }],
    });
    store.dispatch(discussionReactionRequested('ws', 'server-1', '👀'));
    await settle();
    expect(wire.request).toHaveBeenLastCalledWith('discussion.react', {
      workspaceId: 'ws',
      messageId: 'server-1',
      reaction: '👀',
      active: true,
    });
    const confirmed = messages()[0];
    wire.request.mockRejectedValue(new Error('offline'));
    store.dispatch(discussionReactionRequested('ws', 'server-1', '👀'));
    await settle();
    expect(messages()[0]).toEqual(confirmed);
    expect(row().reactionError).toBe('unknown');
    expect(row().reacting).toEqual([]);
    wire.request.mockClear();
    store.dispatch(discussionReactionRequested('ws', 'server-1', '🙂'));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('refreshes equal-version reactor names after a capability upgrade on reconnect', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    const legacy = {
      ...withActions(message(1)),
      reactionVersion: 4,
      reactions: [{ reaction: '👍' as const, count: 1, reacted: false }],
    };
    wire.request.mockResolvedValue({
      messages: [legacy, withActions(message(50))],
      hasMore: false,
    });
    await open();
    vi.mocked(workspaceDiscussionClient.supportsReactions).mockResolvedValue(true);
    const expanded = {
      ...legacy,
      reactions: [{ ...legacy.reactions[0], reactors: [message(1).author] }],
    };
    wire.request.mockImplementation((_method, params) => ({
      messages: params.beforeSequence ? [expanded, withActions(message(50))] : [],
      hasMore: false,
    }));
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
    expect(messages()[0]).toEqual(expanded);
    expect(row().syncedSequence).toBe(50);
    expect(row().metadataBefore).toBeNull();
    expect(workspaceDiscussionClient.supportsReactions).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])(
    'keeps reaction events ahead of stale replies without changing cursors (expanded=%s)',
    async (expanded) => {
      vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
      vi.mocked(workspaceDiscussionClient.supportsReactions).mockResolvedValue(expanded);
      const roster = expanded ? { reactors: [message(1).author] } : {};
      wire.request.mockResolvedValue({ messages: [withActions(message(1))], hasMore: false });
      await open();
      const late = deferred<{
        messageId: string;
        reactions: {
          reaction: '👍';
          count: number;
          reacted: boolean;
          reactors?: DiscussionMessage['author'][];
        }[];
        reactionVersion: number;
      }>();
      wire.request.mockReturnValueOnce(late.promise);
      store.dispatch(discussionReactionRequested('ws', 'server-1', '👍'));
      await settle();
      expect(wire.request).toHaveBeenLastCalledWith('discussion.react', {
        workspaceId: 'ws',
        messageId: 'server-1',
        reaction: '👍',
        active: true,
      });
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId: 'current',
          event: {
            id: 'reaction-event',
            type: 'discussion:reaction',
            workspaceId: 'ws',
            data: {
              workspaceId: 'ws',
              conversationId: 'default',
              messageId: 'server-1',
              reactions: [{ reaction: '👍', count: 2, reacted: true, ...roster }],
              reactionVersion: 2,
            },
          },
        },
        ['current'],
      );
      late.resolve({
        messageId: 'server-1',
        reactions: [{ reaction: '👍', count: 1, reacted: true, ...roster }],
        reactionVersion: 1,
      });
      await settle();
      expect(messages()[0]).toMatchObject({
        reactionVersion: 2,
        reactions: [{ reaction: '👍', count: 2, reacted: true, ...roster }],
      });
      if (expanded) {
        const confirmed = messages()[0];
        for (const invalid of [
          {
            workspaceId: 'ws',
            conversationId: 'default',
            reactions: [{ reaction: '👀', count: 1, reacted: true }],
          },
          {
            workspaceId: 'other',
            conversationId: 'default',
            reactions: [{ reaction: '👀', count: 1, reacted: true, ...roster }],
          },
          {
            workspaceId: 'ws',
            conversationId: 'private',
            reactions: [{ reaction: '👀', count: 1, reacted: true, ...roster }],
          },
        ])
          routeDaemonEventsNotification(
            'events.event',
            {
              subscriptionId: 'current',
              event: {
                id: 'invalid-reaction',
                type: 'discussion:reaction',
                workspaceId: 'ws',
                data: { messageId: 'server-1', reactionVersion: 99, ...invalid },
              },
            },
            ['current'],
          );
        expect(messages()[0]).toEqual(confirmed);
      }
      expect(row().syncedSequence).toBe(1);
      expect(selectDiscussionUnread.select(store.state, 'ws').count).toBe(0);
      wire.request.mockResolvedValue({
        messageId: 'server-1',
        reactions: [{ reaction: '👍', count: 1, reacted: false, ...roster }],
        reactionVersion: 3,
      });
      store.dispatch(discussionReactionRequested('ws', 'server-1', '👍'));
      await settle();
      expect(wire.request).toHaveBeenLastCalledWith('discussion.react', {
        workspaceId: 'ws',
        messageId: 'server-1',
        reaction: '👍',
        active: false,
      });
    },
  );
  it('refreshes reactions on old cached messages after reconnect without rewinding forward history', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    wire.request.mockResolvedValue({
      messages: [withActions(message(1)), withActions(message(50))],
      hasMore: false,
    });
    await open();
    wire.request.mockImplementation((method, params) => {
      if (method !== 'discussion.list') throw new Error('unexpected method');
      if (params.afterSequence === 50) return { messages: [], hasMore: false };
      if (params.afterSequence === 49)
        return { messages: [withActions(message(50))], hasMore: false };
      if (params.beforeSequence === 51)
        return {
          messages: [
            {
              ...withActions(message(1)),
              reactions: [{ reaction: '🙂', count: 1, reacted: false }],
              reactionVersion: 4,
            },
            withActions(message(50)),
          ],
          hasMore: false,
        };
      throw new Error('unexpected cursor');
    });
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
    expect(messages()[0]).toMatchObject({
      reactionVersion: 4,
      reactions: [{ reaction: '🙂', count: 1, reacted: false }],
    });
    expect(row().syncedSequence).toBe(50);
    expect(row().metadataBefore).toBeNull();
  });
  it('retains history and draft while sharing is off, rejects sends, and opens the existing authorized sharing dialog', async () => {
    wire.readSetting.mockResolvedValue({ value: false });
    wire.request.mockResolvedValue({ messages: [message(1)], hasMore: false });
    await open();
    store.dispatch(discussionDraftChanged('ws', 'retained'));
    expect(selectDiscussionCanSend.select(store.state, 'ws')).toBe(false);
    store.dispatch(discussionSendRequested('ws'));
    await settle();
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.send')).toBe(false);
    expect(messages()).toHaveLength(1);
    expect(row().draft).toBe('retained');
    store.dispatch(
      setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
    );
    store.dispatch(discussionEnableSharingRequested('ws'));
    await settle();
    expect(store.state.workspaceShare).toMatchObject({ open: true, workspaceId: 'ws' });
    wire.readSetting.mockResolvedValue({ value: true });
    store.dispatch(settingsChanged([{ path: 'server.tunnel.enabled', value: true }]));
    await settle();
    expect(selectDiscussionCanSend.select(store.state, 'ws')).toBe(true);
  });
  it('does not expose message actions on an older daemon or issue owner settings reads for a guest', async () => {
    await open();
    expect(selectDiscussionCanInteract.select(store.state, 'ws')).toBe(false);
    store.dispatch(discussionReactionRequested('ws', 'server-1', '👍'));
    await settle();
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.react')).toBe(false);
    const context = selectPrincipalConnectionContext.select(store.state)!;
    store.dispatch(principalContextChanged(context));
    const p = store.state.principal;
    store.dispatch(
      principalReceived(
        { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
        {
          principal: {
            id: 'me',
            hostRole: 'guest',
            isAdministrator: false,
            hostMembershipRevision: 2,
            login: null,
            displayName: null,
            avatarUrl: null,
          },
          capabilities: {
            hostMembership: true,
            collaborationIdentity: true,
            personalPairing: true,
            authenticatedDevices: true,
          },
        },
      ),
    );
    await settle();
    wire.readSetting.mockClear();
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(wire.readSetting).not.toHaveBeenCalled();
    store.dispatch(discussionEnableSharingRequested('ws'));
    await settle();
    expect(store.state.workspaceShare.open).toBe(false);
  });
  it('bounds metadata catch-up and resumes the independent cursor on retry beyond 500 cached messages', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    wire.request.mockResolvedValue({
      messages: [withActions(message(1)), withActions(message(600))],
      hasMore: false,
    });
    await open();
    const target = selectDiscussionTarget.select(store.state, 'ws')!;
    for (let n = 2; n < 600; n++)
      store.dispatch(discussionMessageReceived(target, withActions(message(n))));
    wire.request.mockImplementation((method, params) => {
      if (method !== 'discussion.list') throw new Error('unexpected method');
      if (params.afterSequence === 600) return { messages: [], hasMore: false };
      const before = params.beforeSequence;
      if (typeof before !== 'number') throw new Error('missing metadata cursor');
      const start = Math.max(1, before - 50);
      return {
        messages: Array.from({ length: before - start }, (_, i) => ({
          ...withActions(message(start + i)),
          reactionVersion: 3,
          reactions: [{ reaction: '👍', count: 2, reacted: false }],
        })),
        hasMore: start > 1,
      };
    });
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(row()).toMatchObject({
      syncedSequence: 600,
      metadataBefore: 101,
      metadataFloor: 1,
      error: 'unknown',
    });
    expect(
      wire.request.mock.calls.filter(
        ([method, params]) => method === 'discussion.list' && params.beforeSequence,
      ),
    ).toHaveLength(10);
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(row()).toMatchObject({
      syncedSequence: 600,
      metadataBefore: null,
      metadataFloor: null,
      error: null,
    });
    expect(messages()).toHaveLength(600);
    expect(messages()[0]).toMatchObject({ reactionVersion: 3 });
    expect(
      wire.request.mock.calls
        .filter(([method, params]) => method === 'discussion.list' && params.beforeSequence)
        .map(([, params]) => params.beforeSequence),
    ).toEqual([601, 551, 501, 451, 401, 351, 301, 251, 201, 151, 101, 51]);
  });
  it('restarts an interrupted metadata sweep on reconnect and discards the old connection page', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    wire.request.mockResolvedValue({
      messages: [1, 2, 3].map((n) => withActions(message(n))),
      hasMore: false,
    });
    await open();
    const stale = deferred<unknown>();
    let generation = 1;
    wire.request.mockImplementation((method, params) => {
      if (method !== 'discussion.list') throw new Error('unexpected method');
      if (params.afterSequence === 3) return { messages: [], hasMore: false };
      if (params.beforeSequence === 4)
        return {
          messages: [2, 3].map((n) => ({
            ...withActions(message(n)),
            reactionVersion: generation,
            reactions: [{ reaction: '👍', count: generation, reacted: false }],
          })),
          hasMore: true,
        };
      if (params.beforeSequence === 2)
        return generation === 1
          ? stale.promise
          : {
              messages: [withActions(message(1))],
              hasMore: false,
            };
      throw new Error('unexpected cursor');
    });
    store.dispatch(discussionRequested('ws'));
    await settle();
    expect(row().metadataBefore).toBe(2);
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    expect(row().metadataBefore).toBeNull();
    generation = 2;
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    admit();
    await settle();
    expect(messages().at(-1)).toMatchObject({
      reactionVersion: 2,
      reactions: [{ reaction: '👍', count: 2, reacted: false }],
    });
    expect(row()).toMatchObject({
      syncedSequence: 3,
      readSequence: 3,
      metadataBefore: null,
      metadataFloor: null,
      error: null,
    });
    stale.resolve({
      messages: [
        {
          ...withActions(message(1)),
          reactionVersion: 99,
          reactions: [{ reaction: '🙂', count: 99, reacted: false }],
        },
      ],
      hasMore: false,
    });
    await settle();
    expect(messages()[0].reactionVersion).toBe(0);
    expect(
      wire.request.mock.calls
        .filter(([method, params]) => method === 'discussion.list' && params.beforeSequence)
        .map(([, params]) => params.beforeSequence),
    ).toEqual([4, 2, 4, 2]);
  });
  it('cancels pending reactions and discards late replies when workspace access is lost', async () => {
    vi.mocked(workspaceDiscussionClient.supportsMessageActions).mockResolvedValue(true);
    wire.request.mockResolvedValue({ messages: [withActions(message(1))], hasMore: false });
    await open();
    const response = deferred<unknown>();
    wire.request.mockReturnValueOnce(response.promise);
    store.dispatch(discussionReactionRequested('ws', 'server-1', '👍'));
    await settle();
    store.dispatch(replaceWorkspaceList([workspace('other')]));
    await settle();
    response.resolve({
      messageId: 'server-1',
      reactions: [{ reaction: '👍', count: 1, reacted: true }],
      reactionVersion: 1,
    });
    await settle();
    expect(messages()).toEqual([]);
    expect(store.state.workspaceDiscussion.byWorkspaceId.ws).toBeUndefined();
  });
  const sharedConversation = (id = 'default'): DiscussionConversation => ({
    id,
    workspaceId: 'ws',
    kind: 'workspace',
    participants: [],
    name: 'Planning',
    createdAt: '2026-10-16T00:00:00Z',
  });
  async function openManaged(role: 'owner' | 'manager' | 'collaborator' = 'owner', id = 'default') {
    store.dispatch(
      replaceWorkspaceList([
        {
          ...workspace(),
          myRole: role,
          canManage: role !== 'collaborator',
          ownerPrincipalId: role === 'owner' ? 'me' : 'someone-else',
        },
      ]),
    );
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'system.capabilities')
        return { discussionConversations: 1, discussionManagement: 1 };
      if (method === 'discussion.list')
        return {
          messages: [],
          hasMore: false,
          conversation: sharedConversation(params.conversationId ?? 'default'),
        };
      if (method === 'discussion.rename')
        return {
          conversation: { ...sharedConversation(params.conversationId), name: params.name },
        };
      if (method === 'discussion.delete')
        return { deleted: true, conversationId: params.conversationId };
      throw new Error(`Unexpected ${method}`);
    });
    store.dispatch(discussionRequested('ws', id));
    await settle();
  }
  function managementEvent(type: string, conversationId: string, extra = {}) {
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId: 'current',
        event: {
          id: 'management',
          type,
          workspaceId: 'ws',
          data: { workspaceId: 'ws', conversationId, ...extra },
        },
      },
      ['current'],
    );
  }
  it('enables agent mentions from a named discussion history without loading the directory', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    await openManaged('owner', 'named');
    expect(selectDiscussionCanTargetAgents.select(store.state, 'ws', 'named')).toBe(true);
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0, 'named'));
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'named').agentMentions).toEqual([
      { agentId: 'agent-a', name: 'Reviewer', start: 0, end: 9 },
    ]);
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.conversations')).toBe(
      false,
    );
  });
  it.each([true, false])(
    'resolves default visibility only after all directory pages (present=%s)',
    async (present) => {
      const firstPage = deferred<unknown>();
      wire.request.mockImplementation(async (method, params) => {
        if (method === 'system.capabilities')
          return { discussionConversations: 1, discussionManagement: 1 };
        if (method === 'discussion.conversations')
          return params.beforeId
            ? { conversations: [sharedConversation('c1')], hasMore: false }
            : firstPage.promise;
        throw new Error(`Unexpected ${method}`);
      });
      store.dispatch(discussionDirectoryRequested('ws'));
      await settle();
      expect(selectDiscussionDefaultVisible.select(store.state, 'ws')).toBe(true);
      firstPage.resolve({
        conversations: [sharedConversation(present ? 'default' : 'c2')],
        hasMore: true,
      });
      await settle();
      expect(selectDiscussionDefaultVisible.select(store.state, 'ws')).toBe(true);
      store.dispatch(discussionDirectoryRequested('ws', true));
      await settle();
      expect(selectDiscussionDefaultVisible.select(store.state, 'ws')).toBe(present);
      if (present) {
        managementEvent('discussion:deleted', 'default');
        expect(selectDiscussionDefaultVisible.select(store.state, 'ws')).toBe(false);
      }
    },
  );
  it('retains the default fallback for daemons without discussion management', async () => {
    vi.mocked(workspaceDiscussionClient.supportsManagement).mockResolvedValue(false);
    store.dispatch(
      discussionManagementCapabilityReceived(
        selectPrincipalActionContext.select(store.state)!,
        false,
      ),
    );
    multiWire();
    store.dispatch(discussionDirectoryRequested('ws'));
    await settle();
    expect(selectDiscussionDefaultVisible.select(store.state, 'ws')).toBe(true);
  });
  it.each(['owner', 'manager', 'collaborator'] as const)(
    'enforces %s management permissions before sending wire requests',
    async (role) => {
      await openManaged(role);
      expect(selectDiscussionCanRename.select(store.state, 'ws', 'default')).toBe(
        role !== 'collaborator',
      );
      expect(selectDiscussionCanDelete.select(store.state, 'ws', 'default')).toBe(role === 'owner');
      const rename = discussionRenameRequested('ws', 'default', 'Design');
      store.dispatch(rename);
      await settle();
      if (role === 'collaborator') await expect(rename.promise).rejects.toThrow();
      else {
        await expect(rename.promise).resolves.toBeUndefined();
        expect(wire.request).toHaveBeenCalledWith('discussion.rename', {
          workspaceId: 'ws',
          conversationId: 'default',
          name: 'Design',
        });
        expect(selectDiscussionConversations.select(store.state, 'ws')[0].name).toBe('Design');
      }
      const remove = discussionDeleteRequested('ws', 'default');
      store.dispatch(remove);
      await settle();
      if (role === 'owner') {
        await expect(remove.promise).resolves.toBeUndefined();
        expect(wire.request).toHaveBeenCalledWith('discussion.delete', {
          workspaceId: 'ws',
          conversationId: 'default',
        });
        expect(selectDiscussionConversations.select(store.state, 'ws')).toEqual([]);
        expect(selectDiscussionReady.select(store.state, 'ws')).toBe(false);
        expect(selectDiscussionCanCreate.select(store.state, 'ws')).toBe(true);
      } else {
        await expect(remove.promise).rejects.toThrow();
        expect(wire.request.mock.calls.some(([method]) => method === 'discussion.delete')).toBe(
          false,
        );
      }
    },
  );
  it('keeps original private history readable while blocking sends, reactions and management', async () => {
    multiWire();
    store.dispatch(discussionRequested('ws', 'c1'));
    await settle();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'c1')).toHaveLength(1);
    expect(selectDiscussionReadOnly.select(store.state, 'ws', 'c1')).toBe(true);
    expect(selectDiscussionCanSend.select(store.state, 'ws', 'c1')).toBe(false);
    expect(selectDiscussionCanInteract.select(store.state, 'ws', 'c1')).toBe(false);
    expect(selectDiscussionCanRename.select(store.state, 'ws', 'c1')).toBe(false);
    store.dispatch(discussionDraftChanged('ws', 'new private message', 'c1'));
    store.dispatch(discussionSendRequested('ws', 'c1'));
    await settle();
    expect(wire.request.mock.calls.some(([method]) => method === 'discussion.send')).toBe(false);
  });
  it('rejects overlapping management promises and cancels the admitted request on access loss', async () => {
    await openManaged();
    const reply = deferred<{ conversation: DiscussionConversation }>();
    wire.request.mockReturnValue(reply.promise);
    const first = discussionRenameRequested('ws', 'default', 'Design');
    store.dispatch(first);
    await settle();
    expect(selectDiscussionManagementPending.select(store.state, 'ws', 'default')).toBe(true);
    const second = discussionDeleteRequested('ws', 'default');
    store.dispatch(second);
    await settle();
    await expect(second.promise).rejects.toThrow();
    store.dispatch(discussionMembershipInvalidated('ws'));
    await settle();
    await expect(first.promise).rejects.toThrow();
    reply.resolve({ conversation: { ...sharedConversation(), name: 'Design' } });
    await settle();
    expect(selectDiscussionConversations.select(store.state, 'ws')).toEqual([]);
    expect(selectDiscussionManagementPending.select(store.state, 'ws')).toBe(false);
  });
  it('rejects a failed rename promise and preserves the confirmed name for retry', async () => {
    await openManaged();
    wire.request.mockRejectedValueOnce({ rpcCode: -32003 });
    const request = discussionRenameRequested('ws', 'default', 'Design');
    store.dispatch(request);
    await settle();
    await expect(request.promise).rejects.toThrow();
    expect(selectDiscussionManagement.select(store.state, 'ws')).toMatchObject({
      pending: null,
      error: 'forbidden',
    });
    expect(selectDiscussionConversations.select(store.state, 'ws')[0].name).toBe('Planning');
  });
  it('consumes remote lifecycle events and prevents a pending rename acknowledgement restoring a deleted discussion', async () => {
    await openManaged('owner', 'shared');
    managementEvent('discussion:updated', 'shared', {
      conversation: { ...sharedConversation('shared'), name: 'Remote' },
    });
    expect(selectDiscussionConversations.select(store.state, 'ws')[0].name).toBe('Remote');
    const reply = deferred<{ conversation: DiscussionConversation }>();
    wire.request.mockReturnValue(reply.promise);
    const request = discussionRenameRequested('ws', 'shared', 'Local');
    store.dispatch(request);
    await settle();
    managementEvent('discussion:deleted', 'shared');
    reply.resolve({ conversation: { ...sharedConversation('shared'), name: 'Local' } });
    await settle();
    expect(selectDiscussionConversations.select(store.state, 'ws')).toEqual([]);
    expect(selectDiscussionTarget.select(store.state, 'ws', 'shared')).toBeNull();
    managementEvent('discussion:created', 'shared', { conversation: sharedConversation('shared') });
    expect(selectDiscussionConversations.select(store.state, 'ws')).toEqual([]);
  });
  it('sends selected agents on first creation and controls them in the returned workspace conversation', async () => {
    vi.mocked(workspaceDiscussionClient.supportsAgentMessaging).mockResolvedValue(true);
    vi.mocked(workspaceDiscussionClient.supportsAgentActivity).mockResolvedValue(true);
    wire.request.mockImplementation(async (method, params) => {
      if (method === 'system.capabilities')
        return { discussionConversations: 1, discussionManagement: 1 };
      if (method === 'discussion.send')
        return {
          conversation: sharedConversation('shared'),
          message: {
            ...addressed(),
            conversationId: 'shared',
            body: params.body,
            agentMentions: params.agentMentions,
          },
        };
      if (method === 'discussion.stopAgent') return { activity: activity('stopped', 2) };
      throw new Error(`Unexpected ${method}`);
    });
    store.dispatch(discussionRequested('ws', 'new'));
    await settle();
    expect(selectDiscussionCanTargetAgents.select(store.state, 'ws', 'new')).toBe(true);
    store.dispatch(discussionAgentSelected('ws', 'agent-a', 'Reviewer', 0, 0, 'new'));
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    expect(selectDiscussionCreatedId.select(store.state, 'ws')).toBe('shared');
    expect(wire.request).toHaveBeenCalledWith('discussion.send', {
      workspaceId: 'ws',
      messageId: expect.any(String),
      body: '@Reviewer ',
      createConversation: true,
      recipientAgentIds: ['agent-a'],
      agentMentions: [{ agentId: 'agent-a', name: 'Reviewer', start: 0, end: 9 }],
    });
    store.dispatch(
      discussionAgentControlRequested('ws', 'server-1', 'agent-a', 1, 'stop', 'shared'),
    );
    await settle();
    expect(wire.request).toHaveBeenCalledWith('discussion.stopAgent', {
      workspaceId: 'ws',
      conversationId: 'shared',
      messageId: 'server-1',
      agentId: 'agent-a',
      attempt: 1,
    });
    expect(
      selectDiscussionMessages.select(store.state, 'ws', 'shared')[0].agentActivity?.[0].state,
    ).toBe('stopped');
    managementEvent('discussion:activity', 'shared', {
      messageId: 'server-1',
      activity: activity('completed', 3),
    });
    expect(
      selectDiscussionMessages.select(store.state, 'ws', 'shared')[0].agentActivity?.[0].state,
    ).toBe('completed');
  });
  it('does not promote a first-send acknowledgement after its conversation was deleted live', async () => {
    multiWire();
    await openNew();
    const reply = deferred<{ message: DiscussionMessage; conversation: DiscussionConversation }>();
    const normal = wire.request.getMockImplementation()!;
    wire.request.mockImplementation((method, params) =>
      method === 'discussion.send' ? reply.promise : normal(method, params),
    );
    store.dispatch(discussionSendRequested('ws', 'new'));
    await settle();
    managementEvent('discussion:created', 'created', {
      conversation: sharedConversation('created'),
    });
    managementEvent('discussion:deleted', 'created');
    reply.resolve({
      message: privateMessage('created'),
      conversation: sharedConversation('created'),
    });
    await settle();
    expect(selectDiscussionCreatedId.select(store.state, 'ws')).toBeNull();
    expect(selectDiscussionTarget.select(store.state, 'ws', 'created')).toBeNull();
    expect(selectDiscussionMessages.select(store.state, 'ws', 'created')).toEqual([]);
    expect(selectWorkspaceDiscussion.select(store.state, 'ws', 'new')).toMatchObject({
      draft: 'hello',
      sending: false,
      sendError: 'forbidden',
    });
  });
});

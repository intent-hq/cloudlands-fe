import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import type { DiscussionMessage } from '$shared/types/workspace-discussion';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../../store';
import { authRejectedReceived, connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  discussionRequested,
  discussionOlderRequested,
  discussionDraftChanged,
  discussionSendRequested,
  discussionRetryRequested,
  discussionMessageReceived,
} from '../workspace-discussion-slice';
import {
  selectDiscussionMessages,
  selectDiscussionPending,
  selectDiscussionTarget,
  selectDiscussionReady,
  selectWorkspaceDiscussion,
} from '../workspace-discussion-selectors';
import { workspaceDiscussionSaga } from './workspace-discussion-saga';

const wire = vi.hoisted(() => ({ request: vi.fn() }));
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
    vi.useRealTimers();
  });
  async function open() {
    store.dispatch(discussionRequested('ws'));
    await settle();
  }

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
});

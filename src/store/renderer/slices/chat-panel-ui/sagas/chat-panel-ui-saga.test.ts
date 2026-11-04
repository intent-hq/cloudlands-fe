import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: mocks.info } }));
vi.mock('$lib/client', () => ({ appClient: { agents: {} } }));

import type { AgentsClient, UserMessageIndexItem } from '$lib/client/app-client';
import { AgentStatus } from '$shared/types';
import { agentSessionRetryLastMessageRequested } from '../../agent-session/agent-session-slice';
import {
  chatErrorCleared,
  chatSendFailed,
  chatStateReducer,
  initialState as initialChatState,
  scrollbackFetchStarted,
} from '../../chat-state/chat-state-slice';
import { selectRetryAgentUi, selectUserMessageIndexUi } from '../chat-panel-ui-selectors';
import {
  chatPanelRetryAgentRequested,
  chatPanelUiReleased,
  userMessageIndexFinished,
  chatPanelUiReducer,
  userMessageIndexRequested,
} from '../chat-panel-ui-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import type { ChatPanelUiState } from '../chat-panel-ui-types';
import { chatPanelUiSaga } from './chat-panel-ui-saga';

const WS = 'workspace-a';
const AGENT = 'agent-a';
const PANEL = 'panel-a';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function harness() {
  const client = {
    listUserMessages: vi.fn<AgentsClient['listUserMessages']>(),
    retry: vi.fn<AgentsClient['retry']>(),
  };
  let chatPanelUi: ChatPanelUiState = chatPanelUiReducer.initialState;
  let chatState = initialChatState;
  const actions: Array<{ type: string; payload?: unknown }> = [];
  const channel = stdChannel();
  const state = () => ({ chatPanelUi, chatState });
  const dispatch = (action: { type: string; payload?: unknown }) => {
    actions.push(action);
    chatPanelUi = chatPanelUiReducer(chatPanelUi, action);
    chatState = chatStateReducer(chatState, action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: state }, chatPanelUiSaga, client);
  return {
    actions,
    client,
    dispatch,
    state,
    task,
    index: () => selectUserMessageIndexUi.select(state() as never, WS, PANEL),
    retry: () => selectRetryAgentUi.select(state() as never, WS, PANEL),
  };
}

let tasks: Task[] = [];
beforeEach(() => mocks.info.mockClear());
afterEach(async () => {
  for (const task of tasks) task.cancel();
  await Promise.all(tasks.map((task) => task.toPromise()));
  tasks = [];
});

describe('chatPanelUiSaga', () => {
  it('loads the full-history index with the exact wire request', async () => {
    const h = harness();
    tasks.push(h.task);
    h.client.listUserMessages.mockResolvedValue({
      ok: true,
      items: [{ id: 'message-1', preview: 'Prompt', createdAt: '2026-01-01T00:00:00.000Z' }],
      total: 1,
    });

    h.dispatch(userMessageIndexRequested(WS, PANEL, 'request-1', AGENT, 0));
    await settle();

    expect(h.client.listUserMessages).toHaveBeenCalledWith(AGENT, undefined, WS);
    expect(h.index()).toMatchObject({
      requestId: 'request-1',
      status: 'succeeded',
      result: { ok: true, total: 1 },
    });
  });

  it('ignores a superseded response and retains the newest correlated result', async () => {
    const h = harness();
    tasks.push(h.task);
    const first = deferred<Awaited<ReturnType<AgentsClient['listUserMessages']>>>();
    h.client.listUserMessages
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, items: [], total: 0 });

    h.dispatch(userMessageIndexRequested(WS, PANEL, 'old', AGENT, 0));
    h.dispatch(userMessageIndexRequested(WS, PANEL, 'new', AGENT, 0));
    await settle();
    first.resolve({ ok: false, unsupported: false, error: 'late failure' });
    await settle();

    expect(h.index()).toMatchObject({ requestId: 'new', status: 'succeeded' });
    expect(h.index()?.error).toBeUndefined();
  });

  it('cancels an index result after the scrollback epoch changes', async () => {
    const h = harness();
    tasks.push(h.task);
    const pending = deferred<Awaited<ReturnType<AgentsClient['listUserMessages']>>>();
    h.client.listUserMessages.mockReturnValue(pending.promise);

    h.dispatch(userMessageIndexRequested(WS, PANEL, 'request-1', AGENT, 0));
    await settle();
    h.dispatch(scrollbackFetchStarted(AGENT, 'seek'));
    pending.resolve({ ok: true, items: [], total: 0 });
    await settle();

    expect(h.index()).toMatchObject({ requestId: 'request-1', status: 'cancelled' });
  });

  it('settles an in-flight index request as cancelled when the root saga stops', async () => {
    const h = harness();
    tasks.push(h.task);
    h.client.listUserMessages.mockReturnValue(new Promise(() => {}));
    h.dispatch(userMessageIndexRequested(WS, PANEL, 'request-1', AGENT, 0));
    await settle();

    h.task.cancel();
    await h.task.toPromise();

    expect(h.index()).toMatchObject({ requestId: 'request-1', status: 'cancelled' });
  });

  const indexItem = (sequence: number, preview = `Prompt ${sequence}`): UserMessageIndexItem => ({
    id: `message-${sequence}`,
    preview,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, sequence)).toISOString(),
  });

  for (const bound of ['count', 'bytes'] as const) {
    it(`collects every ${bound}-bounded page before succeeding with a complete chronological index`, async () => {
      const h = harness();
      tasks.push(h.task);
      const pageSize = bound === 'count' ? 100 : 2;
      const pages: [UserMessageIndexItem[], UserMessageIndexItem[], UserMessageIndexItem[]] = [
        Array.from({ length: pageSize }, (_, i) => indexItem(pageSize + 1 + i)),
        Array.from({ length: pageSize }, (_, i) => indexItem(1 + i)),
        [indexItem(0)],
      ];
      if (bound === 'bytes') {
        for (const page of pages)
          for (const item of page) item.metadata = { context: 'x'.repeat(200_000) };
      }
      const last = deferred<Awaited<ReturnType<AgentsClient['listUserMessages']>>>();
      h.client.listUserMessages
        .mockResolvedValueOnce({
          ok: true,
          items: pages[0],
          total: pages[0].length,
          nextToken: 'older-1',
        })
        .mockResolvedValueOnce({
          ok: true,
          items: pages[1],
          total: pages[1].length,
          nextToken: 'older-2',
        })
        .mockReturnValueOnce(last.promise);
      h.dispatch(userMessageIndexRequested(WS, PANEL, 'paged', AGENT, 0));
      await vi.waitFor(() => expect(h.client.listUserMessages).toHaveBeenCalledTimes(3));
      expect(h.index()?.status).toBe('pending');
      expect(h.client.listUserMessages.mock.calls).toEqual([
        [AGENT, undefined, WS],
        [AGENT, undefined, WS, { nextToken: 'older-1' }],
        [AGENT, undefined, WS, { nextToken: 'older-2' }],
      ]);
      last.resolve({ ok: true, items: pages[2], total: pages[2].length, nextToken: null });
      await settle();
      expect(h.index()).toMatchObject({
        status: 'succeeded',
        result: {
          ok: true,
          total: 2 * pageSize + 1,
          items: [...pages[2], ...pages[1], ...pages[0]],
        },
      });
      expect(
        h.actions.filter((action) => action.type === userMessageIndexFinished.type),
      ).toHaveLength(1);
    });
  }

  it('deduplicates overlapping page boundaries using the later row while retaining oldest-to-newest order', async () => {
    const h = harness();
    tasks.push(h.task);
    const updated = { ...indexItem(3, 'Refreshed boundary'), metadata: { revised: true } };
    h.client.listUserMessages
      .mockResolvedValueOnce({
        ok: true,
        items: [indexItem(3, 'Old boundary'), indexItem(4)],
        total: 2,
        nextToken: 'older',
      })
      .mockResolvedValueOnce({
        ok: true,
        items: [indexItem(1), indexItem(2), updated],
        total: 3,
        nextToken: null,
      });
    h.dispatch(userMessageIndexRequested(WS, PANEL, 'duplicates', AGENT, 0));
    await vi.waitFor(() => expect(h.index()?.status).toBe('succeeded'));
    expect(h.index()?.result).toEqual({
      ok: true,
      total: 4,
      items: [indexItem(1), indexItem(2), updated, indexItem(4)],
    });
  });

  for (const boundary of [
    'superseded',
    'agent changed',
    'discard epoch',
    'consumer released',
    'workspace removed',
    'cancelled',
  ] as const) {
    it(`does not follow a pending page or publish its result after ${boundary}`, async () => {
      const h = harness();
      tasks.push(h.task);
      const page = deferred<Awaited<ReturnType<AgentsClient['listUserMessages']>>>();
      h.client.listUserMessages
        .mockResolvedValueOnce({ ok: true, items: [indexItem(2)], total: 1, nextToken: 'older' })
        .mockReturnValueOnce(page.promise)
        .mockResolvedValue({ ok: true, items: [indexItem(9)], total: 1 });
      h.dispatch(userMessageIndexRequested(WS, PANEL, 'old', AGENT, 0));
      await vi.waitFor(() => expect(h.client.listUserMessages).toHaveBeenCalledTimes(2));
      if (boundary === 'superseded')
        h.dispatch(userMessageIndexRequested(WS, PANEL, 'new', AGENT, 0));
      if (boundary === 'agent changed')
        h.dispatch(userMessageIndexRequested(WS, PANEL, 'old', 'agent-b', 0));
      if (boundary === 'discard epoch') h.dispatch(scrollbackFetchStarted(AGENT, 'seek'));
      if (boundary === 'consumer released') h.dispatch(chatPanelUiReleased(WS, PANEL));
      if (boundary === 'workspace removed') h.dispatch(workspaceUnmounted(WS));
      if (boundary === 'cancelled') {
        h.task.cancel();
        await h.task.toPromise();
      }
      await settle();
      const callsBeforeLatePage = h.client.listUserMessages.mock.calls.length;
      const completionsBeforeLatePage = h.actions.filter(
        (action) => action.type === userMessageIndexFinished.type,
      ).length;
      page.resolve({ ok: true, items: [indexItem(1)], total: 1, nextToken: 'must-not-follow' });
      await settle();
      expect(h.client.listUserMessages).toHaveBeenCalledTimes(callsBeforeLatePage);
      const completions = h.actions.filter(
        (action) => action.type === userMessageIndexFinished.type,
      );
      if (boundary === 'discard epoch') {
        expect(h.index()?.status).toBe('cancelled');
        expect(completions).toHaveLength(completionsBeforeLatePage + 1);
      } else expect(completions).toHaveLength(completionsBeforeLatePage);
      if (boundary === 'superseded' || boundary === 'agent changed')
        expect(h.index()?.result).toEqual({ ok: true, items: [indexItem(9)], total: 1 });
      if (boundary === 'consumer released' || boundary === 'workspace removed')
        expect(h.index()).toBeUndefined();
    });
  }

  for (const failure of [
    'throw',
    'typed error',
    'unsupported later page',
    'repeated cursor',
    'cursor cycle',
  ] as const) {
    it(`fails without partial success and retains a prior index for ${failure}`, async () => {
      const h = harness();
      tasks.push(h.task);
      const prior = { ok: true as const, items: [indexItem(8)], total: 1 };
      h.client.listUserMessages.mockResolvedValueOnce(prior);
      h.dispatch(userMessageIndexRequested(WS, PANEL, 'prior', AGENT, 0));
      await settle();
      h.client.listUserMessages.mockResolvedValueOnce({
        ok: true,
        items: [indexItem(3)],
        total: 1,
        nextToken: 'older',
      });
      if (failure === 'throw')
        h.client.listUserMessages.mockRejectedValueOnce(new Error('later read failed'));
      else if (failure === 'typed error' || failure === 'unsupported later page')
        h.client.listUserMessages.mockResolvedValueOnce({
          ok: false,
          unsupported: failure === 'unsupported later page',
          error: 'later read failed',
        });
      else if (failure === 'cursor cycle')
        h.client.listUserMessages
          .mockResolvedValueOnce({ ok: true, items: [indexItem(2)], total: 1, nextToken: 'oldest' })
          .mockResolvedValueOnce({ ok: true, items: [indexItem(1)], total: 1, nextToken: 'older' });
      else
        h.client.listUserMessages.mockResolvedValueOnce({
          ok: true,
          items: [indexItem(2)],
          total: 1,
          nextToken: 'older',
        });
      h.dispatch(userMessageIndexRequested(WS, PANEL, 'refresh', AGENT, 0));
      await vi.waitFor(() => expect(h.index()?.status).toBe('failed'));
      expect(h.index()?.result).toEqual(prior);
      expect(h.index()?.error).toEqual(expect.any(String));
      expect(h.client.listUserMessages).toHaveBeenCalledTimes(failure === 'cursor cycle' ? 4 : 3);
      expect(h.actions).not.toContainEqual(
        expect.objectContaining({
          type: userMessageIndexFinished.type,
          payload: expect.arrayContaining(['refresh', 'succeeded']),
        }),
      );
    });
  }

  it('follows advancing cursors through empty first and middle pages and duplicate-only pages', async () => {
    const h = harness();
    tasks.push(h.task);
    const finalPage = deferred<Awaited<ReturnType<AgentsClient['listUserMessages']>>>();
    const refreshed = indexItem(3, 'Latest boundary');
    h.client.listUserMessages
      .mockResolvedValueOnce({ ok: true, items: [], total: 0, nextToken: 'first' })
      .mockResolvedValueOnce({ ok: true, items: [indexItem(3)], total: 1, nextToken: 'middle' })
      .mockResolvedValueOnce({ ok: true, items: [], total: 0, nextToken: 'duplicate' })
      .mockResolvedValueOnce({ ok: true, items: [refreshed], total: 1, nextToken: 'last' })
      .mockReturnValueOnce(finalPage.promise);
    h.dispatch(userMessageIndexRequested(WS, PANEL, 'filtered', AGENT, 0));
    await vi.waitFor(() => expect(h.client.listUserMessages).toHaveBeenCalledTimes(5));
    expect(h.index()?.status).toBe('pending');
    expect(h.client.listUserMessages.mock.calls).toEqual([
      [AGENT, undefined, WS],
      [AGENT, undefined, WS, { nextToken: 'first' }],
      [AGENT, undefined, WS, { nextToken: 'middle' }],
      [AGENT, undefined, WS, { nextToken: 'duplicate' }],
      [AGENT, undefined, WS, { nextToken: 'last' }],
    ]);
    finalPage.resolve({ ok: true, items: [indexItem(1), indexItem(2)], total: 2, nextToken: null });
    await settle();
    expect(h.index()).toMatchObject({
      status: 'succeeded',
      result: {
        ok: true,
        total: 3,
        items: [indexItem(1), indexItem(2), refreshed],
      },
    });
    expect(
      h.actions.filter((action) => action.type === userMessageIndexFinished.type),
    ).toHaveLength(1);
  });

  it('retains the unsupported-daemon fallback on an initial no-token request', async () => {
    const h = harness();
    tasks.push(h.task);
    h.client.listUserMessages.mockResolvedValue({
      ok: false,
      unsupported: true,
      error: 'Unsupported',
    });
    h.dispatch(userMessageIndexRequested(WS, PANEL, 'legacy', AGENT, 0));
    await settle();
    expect(h.client.listUserMessages.mock.calls).toEqual([[AGENT, undefined, WS]]);
    expect(h.index()).toMatchObject({ status: 'succeeded', unsupported: true });
  });

  it('redrives an errored agent and converges idle when no queued turn exists', async () => {
    const h = harness();
    tasks.push(h.task);
    h.client.retry.mockResolvedValue({ ok: true, redriven: false });

    h.dispatch(chatPanelRetryAgentRequested(WS, PANEL, 'retry-1', AGENT));
    await settle();

    expect(h.client.retry).toHaveBeenCalledWith(AGENT, WS);
    expect(h.retry()).toMatchObject({ requestId: 'retry-1', status: 'succeeded' });
    expect(h.actions).toContainEqual(chatErrorCleared(AGENT));
    expect(h.actions).toContainEqual(
      expect.objectContaining({
        type: 'agentSessions/updateSession',
        payload: [AGENT, { status: AgentStatus.RuntimeIdle, stopReason: null }],
      }),
    );
    expect(mocks.info).toHaveBeenCalledOnce();
  });

  it('restores the prior failure and falls back to retry-last-message when redrive fails', async () => {
    const h = harness();
    tasks.push(h.task);
    h.client.retry.mockResolvedValue({ ok: false, error: '' });
    h.dispatch(chatSendFailed(AGENT, 'prior failure'));

    h.dispatch(chatPanelRetryAgentRequested(WS, PANEL, 'retry-1', AGENT));
    await settle();

    expect(h.retry()).toMatchObject({ status: 'failed', error: 'prior failure' });
    expect(h.actions).toContainEqual(chatSendFailed(AGENT, 'prior failure'));
    expect(h.actions).toContainEqual(
      expect.objectContaining({
        type: agentSessionRetryLastMessageRequested.type,
        payload: [AGENT, WS],
      }),
    );
  });
});

import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: mocks.info } }));
vi.mock('$lib/client', () => ({ appClient: { agents: {} } }));

import type { AgentsClient } from '$lib/client/app-client';
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
  chatPanelUiReducer,
  userMessageIndexRequested,
} from '../chat-panel-ui-slice';
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

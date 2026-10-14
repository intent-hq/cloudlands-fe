import { createMessageBlockHydrationWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/message-block-hydration-workers';
import { createMessageHistorySeeker } from '../../../../../../src/store/renderer/slices/chat-state/message-history-seeker';
import { createHistoryPageWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/history-page-workers';
import {
  getAgentChatState,
  getHydratedBlock,
} from '../../../../../../src/store/renderer/slices/chat-state/chat-state-projections';
import * as history from '../../../../../../src/store/renderer/slices/agent-session/agent-history-projections';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { ChatClient, ChatTranscript, AgentsClient } from '$lib/client/app-client';
import type { AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import { agentSessionReducer } from '../../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  chatStateReducer,
  messageBlockHydrationRequested,
  olderHistoryPageRequested,
  messageHistoryRequested,
  messageHistoryReleased,
  retainedChatTranscriptsSet,
} from '../../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { createReadOnlyChatSaga } from '../../../../../../src/store/renderer/slices/chat-state/sagas/read-only-chat-saga-factory';

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
});
const workspaceId = WorkspaceId('workspace-a');
const session: AgentSession = {
  id: AgentId('agent-a'),
  workspaceId,
  backendSessionId: null,
  name: 'Existing agent',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
};
const transcript: ChatTranscript = {
  messages: [
    {
      id: 'message-1',
      role: 'assistant',
      timestamp: '2026-10-14T00:00:00Z',
      contentBlocks: [{ type: 'text', text: 'Real boundary input' }],
    },
  ],
  truncated: false,
  totalMessages: 1,
  isStreaming: false,
  fromSnapshot: true,
};
function setup(
  read = vi.fn(async () => session),
  getConversation = vi.fn<AgentsClient['getConversation']>(),
  getMessageBlock = vi.fn<AgentsClient['getMessageBlock']>(),
) {
  const store = new ReactStore({
    agentSessions: agentSessionReducer,
    chatState: chatStateReducer,
    daemonHealth: daemonHealthReducer,
  });
  stops.push(store.init());
  const context = store.createSelector((state) =>
    state.daemonHealth.health === 'down' ? null : String(state.daemonHealth.connectionGeneration),
  );
  const handlers: Array<(value: ChatTranscript) => void> = [];
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const subscribe = vi.fn<ChatClient['subscribe']>((_id, callback, phase) => {
    handlers.push(callback);
    const close = vi.fn();
    closes.push(close);
    phase?.('live');
    callback(transcript);
    return close;
  });
  stops.push(
    store.runSaga(
      createReadOnlyChatSaga({
        chat: { subscribe },
        messageBlocks: createMessageBlockHydrationWorkers({
          getMessageBlock,
          readEntry: store.createSelector(getHydratedBlock).effect,
          readWorkspaceId: store.createSelector(
            (state, id: string) => state.agentSessions.byAgentId[id]?.workspaceId,
          ).effect,
        }),
        seekMessage: createMessageHistorySeeker({
          getConversation,
          readChat: (id) => getAgentChatState(store.state, id),
          readSession: (id) => store.state.agentSessions.byAgentId[id],
          hasMessage: (id, messageId) =>
            [
              ...(store.state.agentSessions.byAgentId[id]?.messages ?? []),
              ...history.getAgentHistoryMessages(store.state, id),
            ].some((message) => message.id === messageId),
          dispatch: store.dispatch,
        }),
        historyPages: createHistoryPageWorkers({
          getConversation,
          readChat: store.createSelector(getAgentChatState).effect,
          readMeta: store.createSelector(history.getHistorySegmentMeta).effect,
          readHistory: store.createSelector(history.getAgentHistoryMessages).effect,
          hasHistory: store.createSelector(history.getHasHistorySegment).effect,
          readTail: store.createSelector(
            (state, id: string) => state.agentSessions.byAgentId[id]?.messages ?? [],
          ).effect,
          readSession: store.createSelector(
            (state, id: string) => state.agentSessions.byAgentId[id],
          ).effect,
          isDeleted: () => false,
        }),
        readAgentSession: read,
        contextSelector: context,
        readAdmission: () => context.select(store.state),
      }),
    ),
  );
  const connected = (value: boolean) =>
    store.dispatch(connectionStatusChanged(value ? 'connected' : 'disconnected'));
  const lease = (owner: string, ids: string[]) =>
    store.dispatch(retainedChatTranscriptsSet(owner, workspaceId, ids));
  return {
    store,
    read,
    subscribe,
    handlers,
    closes,
    connected,
    lease,
    getConversation,
    getMessageBlock,
  };
}
describe('read-only conversation ownership with canonical reducers', () => {
  it('shares one stream between consumers, rejects retired callbacks, and reconnects from a fresh snapshot', async () => {
    const h = setup();
    h.connected(true);
    h.lease('one', [session.id]);
    h.lease('two', [session.id]);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.transcriptHydration).toBe('settled'),
    );
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.store.state.agentSessions.byAgentId[session.id]?.messages.map((m) => m.id)).toEqual([
      'message-1',
    ]);
    h.lease('one', []);
    expect(h.closes[0]).not.toHaveBeenCalled();
    h.connected(false);
    await vi.waitFor(() => expect(h.closes[0]).toHaveBeenCalledOnce());
    h.handlers[0]?.({ ...transcript, messages: [] });
    expect(h.store.state.agentSessions.byAgentId[session.id]?.messages).toHaveLength(1);
    h.connected(true);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(2));
    h.lease('two', []);
    await vi.waitFor(() => expect(h.closes[1]).toHaveBeenCalledOnce());
    expect(h.store.state.chatState.byAgentId[session.id]?.liveStreamPhase).toBeNull();
  });
  it('never subscribes or hydrates after an in-flight session read loses its consumer', async () => {
    let resolve!: (value: AgentSession) => void;
    const h = setup(
      vi.fn(
        () =>
          new Promise<AgentSession>((done) => {
            resolve = done;
          }),
      ),
    );
    h.connected(true);
    h.lease('one', [session.id]);
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    h.lease('one', []);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.trackedWorkspaceId).toBeNull(),
    );
    resolve(session);
    await Promise.resolve();
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.store.state.agentSessions.byAgentId[session.id]).toBeUndefined();
  });
  it('does not admit a session from another workspace and permits a read-only retry', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...session, workspaceId: WorkspaceId('other') })
      .mockResolvedValue(session);
    const h = setup(read);
    h.connected(true);
    h.lease('one', [session.id]);
    await vi.waitFor(() =>
      expect(h.store.state.chatState.byAgentId[session.id]?.transcriptHydration).toBe('error'),
    );
    expect(h.subscribe).not.toHaveBeenCalled();
    h.lease('one', [session.id]);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
  });
});

describe('leased canonical history paging', () => {
  const page = (id: string, nextToken: string | null) => ({
    messages: [{ ...transcript.messages[0]!, id, seq: 0 }],
    truncated: true,
    totalMessages: 50,
    nextToken,
    prevToken: 'forward',
  });
  const tail = { ...transcript, truncated: true, totalMessages: 50, nextToken: 'older-1' };
  it('waits for the progressive snapshot and uses its completed older cursor', async () => {
    const h = setup(
      undefined,
      vi.fn<AgentsClient['getConversation']>().mockResolvedValue(page('progress-older', null)),
    );
    h.connected(true);
    h.lease('reader', [session.id]);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
    h.handlers[0]!({
      ...tail,
      nextToken: undefined,
      initialHistory: { target: 20, received: 1, complete: false },
    });
    h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
    expect(h.getConversation).not.toHaveBeenCalled();
    h.handlers[0]!({
      ...tail,
      fromSnapshot: false,
      fromHistory: true,
      nextToken: 'completed-cursor',
      initialHistory: { target: 20, received: 20, complete: true },
    });
    expect(getAgentChatState(h.store.state, session.id).initialHistoryPending).toBe(false);
    h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
    await vi.waitFor(() => expect(h.getConversation).toHaveBeenCalledOnce());
    expect(h.getConversation.mock.calls[0]?.[2]).toBe('completed-cursor');
  });
  it('uses snapshot and continued cursors, preserves history across tail updates and releases the segment', async () => {
    const h = setup(
      undefined,
      vi
        .fn<AgentsClient['getConversation']>()
        .mockResolvedValueOnce(page('older-a', 'older-2'))
        .mockResolvedValueOnce(page('older-b', null)),
    );
    h.connected(true);
    h.lease('reader', [session.id]);
    await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
    h.handlers[0]!(tail);
    h.store.dispatch(olderHistoryPageRequested('wrong-workspace', session.id));
    expect(h.getConversation).not.toHaveBeenCalled();
    h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
    await vi.waitFor(() =>
      expect(history.getAgentHistoryMessages(h.store.state, session.id).map((m) => m.id)).toEqual([
        'older-a',
      ]),
    );
    expect(h.getConversation.mock.calls[0]).toEqual([
      session.id,
      5,
      'older-1',
      undefined,
      undefined,
      workspaceId,
    ]);
    h.handlers[0]!({ ...tail, fromSnapshot: false });
    expect(history.getAgentHistoryMessages(h.store.state, session.id)[0]?.id).toBe('older-a');
    h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
    await vi.waitFor(() =>
      expect(history.getHistorySegmentMeta(h.store.state, session.id).oldestReached).toBe(true),
    );
    expect(h.getConversation.mock.calls[1]?.[2]).toBe('older-2');
    h.lease('reader', []);
    await vi.waitFor(() => expect(h.closes[0]).toHaveBeenCalledOnce());
    expect(history.getHasHistorySegment(h.store.state, session.id)).toBe(false);
    expect(getAgentChatState(h.store.state, session.id).scrollbackOlderToken).toBeNull();
    h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
    expect(h.getConversation).toHaveBeenCalledTimes(2);
  });
  it.each(['release', 'disconnect'] as const)(
    'drops late history on %s, deduplicates pending requests, and starts a fresh walk on return',
    async (retire) => {
      let resolve!: (value: Awaited<ReturnType<AgentsClient['getConversation']>>) => void;
      const getConversation = vi
        .fn<AgentsClient['getConversation']>()
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValue(page('fresh-history', null));
      const h = setup(undefined, getConversation);
      h.connected(true);
      h.lease('reader', [session.id]);
      await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
      h.handlers[0]!(tail);
      h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
      h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
      expect(getConversation).toHaveBeenCalledOnce();
      if (retire === 'release') h.lease('reader', []);
      else h.connected(false);
      await vi.waitFor(() => expect(h.closes[0]).toHaveBeenCalledOnce());
      resolve(page('stale-history', 'stale-cursor'));
      await Promise.resolve();
      expect(history.getHasHistorySegment(h.store.state, session.id)).toBe(false);
      expect(getAgentChatState(h.store.state, session.id).fetchingOlderHistory).toBe(false);
      if (retire === 'release') h.lease('reader', [session.id]);
      else h.connected(true);
      await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(2));
      h.handlers[1]!({ ...tail, nextToken: 'fresh-cursor' });
      h.store.dispatch(olderHistoryPageRequested(workspaceId, session.id));
      await vi.waitFor(() =>
        expect(history.getAgentHistoryMessages(h.store.state, session.id).map((m) => m.id)).toEqual(
          ['fresh-history'],
        ),
      );
      expect(getConversation.mock.calls[1]?.[2]).toBe('fresh-cursor');
    },
  );
});

describe('message targets owned by the admitted reader', () => {
  const page = {
    messages: [{ ...transcript.messages[0]!, id: 'older-target', seq: 0 }],
    truncated: true,
    totalMessages: 50,
    nextToken: null,
    prevToken: 'toward-tail',
  };
  const ready = async (h: ReturnType<typeof setup>) => {
    h.connected(true);
    h.lease('reader', [session.id]);
    await vi.waitFor(() =>
      expect(getAgentChatState(h.store.state, session.id).transcriptHydration).toBe('settled'),
    );
  };
  const request = (h: ReturnType<typeof setup>, messageId: string, requestId = 'target-request') =>
    h.store.dispatch(
      messageHistoryRequested('reader', workspaceId, session.id, messageId, requestId),
    );

  it('uses the resident row without a read and seeks older rows into canonical history while keeping the tail', async () => {
    const h = setup(undefined, vi.fn<AgentsClient['getConversation']>().mockResolvedValue(page));
    await ready(h);
    await expect(request(h, 'message-1')).resolves.toBe(true);
    expect(h.getConversation).not.toHaveBeenCalled();
    await expect(request(h, 'older-target')).resolves.toBe(true);
    expect(h.getConversation).toHaveBeenCalledExactlyOnceWith(
      session.id,
      5,
      undefined,
      'older-target',
      undefined,
      workspaceId,
    );
    expect(h.store.state.agentSessions.byAgentId[session.id]?.messages.map((m) => m.id)).toEqual([
      'message-1',
    ]);
    expect(history.getAgentHistoryMessages(h.store.state, session.id).map((m) => m.id)).toEqual([
      'older-target',
    ]);
    expect(getAgentChatState(h.store.state, session.id)).toMatchObject({
      fetchingHistorySeek: false,
      scrollbackGapToken: 'toward-tail',
      scrollbackOlderToken: null,
    });
    h.lease('reader', []);
    expect(history.getHasHistorySegment(h.store.state, session.id)).toBe(false);
  });

  it('keeps a newer message window when a retired target replies late', async () => {
    let resolve!: (value: typeof page) => void;
    const nextPage = { ...page, messages: [{ ...page.messages[0]!, id: 'new-target' }] };
    const h = setup(
      undefined,
      vi
        .fn<AgentsClient['getConversation']>()
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        )
        .mockResolvedValueOnce(nextPage),
    );
    await ready(h);
    const previous = request(h, 'older-target', 'old-request');
    const rejected = expect(previous).rejects.toThrow('cancelled');
    h.store.dispatch(messageHistoryReleased('old-request'));
    await rejected;
    await expect(request(h, 'new-target', 'new-request')).resolves.toBe(true);
    resolve(page);
    await Promise.resolve();
    expect(history.getAgentHistoryMessages(h.store.state, session.id).map((m) => m.id)).toEqual([
      'new-target',
    ]);
    expect(getAgentChatState(h.store.state, session.id).fetchingHistorySeek).toBe(false);
  });

  it('settles a missing target without manufacturing a row and rejects an absent reader', async () => {
    const h = setup(
      undefined,
      vi.fn<AgentsClient['getConversation']>().mockResolvedValue({ ...page, messages: [] }),
    );
    await expect(request(h, 'missing')).rejects.toThrow('no longer admitted');
    expect(h.getConversation).not.toHaveBeenCalled();
    await ready(h);
    await expect(request(h, 'missing')).resolves.toBe(false);
    expect(history.getHasHistorySegment(h.store.state, session.id)).toBe(false);
    expect(getAgentChatState(h.store.state, session.id).fetchingHistorySeek).toBe(false);
  });

  it.each(['native input', 'release', 'disconnect'] as const)(
    'retires a pending seek on %s and rejects a late page',
    async (reason) => {
      let resolve!: (value: typeof page) => void;
      const h = setup(
        undefined,
        vi.fn<AgentsClient['getConversation']>(
          () =>
            new Promise((done) => {
              resolve = done;
            }),
        ),
      );
      await ready(h);
      const pending = request(h, 'older-target');
      const rejected = expect(pending).rejects.toThrow('cancelled');
      await vi.waitFor(() => expect(h.getConversation).toHaveBeenCalledOnce());
      expect(getAgentChatState(h.store.state, session.id).fetchingHistorySeek).toBe(true);
      if (reason === 'native input') h.store.dispatch(messageHistoryReleased('target-request'));
      else if (reason === 'release') h.lease('reader', []);
      else h.connected(false);
      await rejected;
      expect(getAgentChatState(h.store.state, session.id).fetchingHistorySeek).toBe(false);
      resolve(page);
      await Promise.resolve();
      await Promise.resolve();
      expect(history.getHasHistorySegment(h.store.state, session.id)).toBe(false);
      expect(getAgentChatState(h.store.state, session.id).scrollbackGapToken).toBeNull();
    },
  );
});

describe('full tool blocks owned by the admitted reader', () => {
  const full = { type: 'tool_result' as const, id: 'message-1:0', output: 'Complete tool output' };
  const ready = async (h: ReturnType<typeof setup>) => {
    h.connected(true);
    h.lease('reader', [session.id]);
    await vi.waitFor(() =>
      expect(getAgentChatState(h.store.state, session.id).transcriptHydration).toBe('settled'),
    );
  };
  const request = (h: ReturnType<typeof setup>) =>
    h.store.dispatch(messageBlockHydrationRequested(session.id, 'message-1', full.id));
  const entry = (h: ReturnType<typeof setup>) =>
    getHydratedBlock(h.store.state, session.id, 'message-1', full.id);

  it('deduplicates in-flight reads and reuses the canonical loaded block', async () => {
    let resolve!: (block: typeof full) => void;
    const h = setup(
      undefined,
      undefined,
      vi.fn<AgentsClient['getMessageBlock']>(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    await ready(h);
    request(h);
    request(h);
    expect(h.getMessageBlock).toHaveBeenCalledExactlyOnceWith(
      session.id,
      'message-1',
      full.id,
      workspaceId,
    );
    expect(entry(h)?.status).toBe('loading');
    resolve(full);
    await vi.waitFor(() => expect(entry(h)).toMatchObject({ status: 'loaded', block: full }));
    request(h);
    expect(h.getMessageBlock).toHaveBeenCalledTimes(1);
  });

  it('releases the loading marker when admission changes before cancellation reaches the worker', async () => {
    const store = new ReactStore({ chatState: chatStateReducer });
    stops.push(store.init());
    let admitted = true;
    let resolve!: (block: typeof full) => void;
    const getMessageBlock = vi.fn<AgentsClient['getMessageBlock']>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const workers = createMessageBlockHydrationWorkers({
      getMessageBlock,
      readEntry: store.createSelector(getHydratedBlock).effect,
      readWorkspaceId: store.createSelector(() => workspaceId).effect,
    });
    stops.push(
      store.runSaga(function* () {
        yield* workers.watch(() => admitted, true);
      }),
    );
    store.dispatch(messageBlockHydrationRequested(session.id, 'message-1', full.id));
    expect(getHydratedBlock(store.state, session.id, 'message-1', full.id)?.status).toBe('loading');
    admitted = false;
    resolve(full);
    await vi.waitFor(() =>
      expect(getHydratedBlock(store.state, session.id, 'message-1', full.id)?.status).toBe('error'),
    );
    admitted = true;
    getMessageBlock.mockResolvedValue(full);
    store.dispatch(messageBlockHydrationRequested(session.id, 'message-1', full.id));
    await vi.waitFor(() =>
      expect(getHydratedBlock(store.state, session.id, 'message-1', full.id)).toMatchObject({
        status: 'loaded',
        block: full,
      }),
    );
  });

  it('retains the canonical error and retries only on another user request', async () => {
    const h = setup(
      undefined,
      undefined,
      vi
        .fn<AgentsClient['getMessageBlock']>()
        .mockRejectedValueOnce(new Error('read failed'))
        .mockResolvedValue(full),
    );
    await ready(h);
    request(h);
    await vi.waitFor(() =>
      expect(entry(h)).toMatchObject({ status: 'error', error: 'read failed' }),
    );
    expect(h.getMessageBlock).toHaveBeenCalledTimes(1);
    request(h);
    await vi.waitFor(() => expect(entry(h)).toMatchObject({ status: 'loaded', block: full }));
    expect(h.getMessageBlock).toHaveBeenCalledTimes(2);
  });

  it.each(['return', 'disconnect'] as const)(
    'retires a pending read on %s without poisoning a reopened reader',
    async (reason) => {
      let resolve!: (block: typeof full) => void;
      const replacement = { ...full, output: 'New reader output' };
      const h = setup(
        undefined,
        undefined,
        vi
          .fn<AgentsClient['getMessageBlock']>()
          .mockImplementationOnce(
            () =>
              new Promise((done) => {
                resolve = done;
              }),
          )
          .mockResolvedValue(replacement),
      );
      await ready(h);
      request(h);
      expect(entry(h)?.status).toBe('loading');
      if (reason === 'return') h.lease('reader', []);
      else h.connected(false);
      await vi.waitFor(() => expect(entry(h)?.status).toBe('error'));
      await ready(h);
      request(h);
      await vi.waitFor(() =>
        expect(entry(h)).toMatchObject({ status: 'loaded', block: replacement }),
      );
      resolve(full);
      await Promise.resolve();
      await Promise.resolve();
      expect(entry(h)).toMatchObject({ status: 'loaded', block: replacement });
      expect(h.getMessageBlock).toHaveBeenCalledTimes(2);
      h.lease('reader', []);
      h.store.dispatch(messageBlockHydrationRequested(session.id, 'message-2', 'message-2:0'));
      expect(h.getMessageBlock).toHaveBeenCalledTimes(2);
    },
  );
});

import { createHistoryPageWorkers } from '../../../../../../src/store/renderer/slices/chat-state/sagas/history-page-workers';
import { getAgentChatState } from '../../../../../../src/store/renderer/slices/chat-state/chat-state-projections';
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
  olderHistoryPageRequested,
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
  return { store, read, subscribe, handlers, closes, connected, lease, getConversation };
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

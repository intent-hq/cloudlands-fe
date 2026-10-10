import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentSession } from '$shared/types';
import type { BackendNotification } from '$lib/client/live/backend-transport';

// Fake only the daemon transport: snapshots pass through LiveChatClient, the
// subscription saga and the real store's canonical message ordering.
const wire = vi.hoisted(() => ({
  request: vi.fn(),
  notifications: new Set<(notification: BackendNotification) => void>(),
  reconnects: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: wire.request,
  onBackendNotification: (handler: (notification: BackendNotification) => void) => {
    wire.notifications.add(handler);
    return () => wire.notifications.delete(handler);
  },
  onBackendReconnected: (handler: () => void) => {
    wire.reconnects.add(handler);
    return () => wire.reconnects.delete(handler);
  },
}));
vi.mock('$lib/client', async () => {
  const { LiveChatClient } = await import('$lib/client/live/live-chat-client');
  return {
    appClient: {
      chat: new LiveChatClient(),
      agents: { get: vi.fn(), getConversation: vi.fn() },
    },
  };
});
vi.mock('$features/events/daemon-events-bridge.client', () => ({
  seedStreamFromSnapshot: vi.fn(),
}));

import { appClient } from '$lib/client';
import { AgentStatus } from '$shared/types/agent.types';
import { store } from '$store/renderer/store';
import {
  addMessage,
  bulkUpsertSessions,
  clearAllSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectAgentMessages,
  selectAgentHistoryMessages,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  initializeChatRequested,
  olderHistoryPageRequested,
  chatSendStarted,
  refreshChatTranscriptRequested,
} from '../chat-state-slice';
import { selectTranscriptSnapshotMeta, selectChatAgentState } from '../chat-state-selectors';
import { chatSubscribeSaga } from './chat-subscribe-saga';
import { chatScrollbackSaga } from './chat-scrollback-saga';
import { chatReadSaga } from './chat-read-saga';

const AGENT = 'agent-sleep';
const WS = 'ws-sleep';
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const rows = () => selectAgentMessages.select(store.state, AGENT);
function message(id: string, seq?: number): AgentMessage {
  return {
    id,
    agentId: AGENT,
    role: 'assistant',
    timestamp: '2026-10-06T01:00:00.000Z',
    contentBlocks: [{ type: 'text', id: `${id}:0`, text: `Content for ${id}` }],
    ...(seq === undefined ? { isStreaming: true } : { seq, streamingComplete: true }),
  };
}
function snapshot(
  subscriptionId: string,
  messages: AgentMessage[],
  extra: Record<string, unknown> = {},
): void {
  for (const handler of wire.notifications) {
    handler({
      method: 'subscription.push',
      params: {
        subscriptionId,
        kind: 'snapshot',
        seq: 0,
        snapshot: {
          agentId: AGENT,
          messages,
          truncated: false,
          totalMessages: messages.length,
          nextToken: null,
          deltaEncoding: 'incremental',
          ...extra,
        },
      },
    });
  }
}
const stops: Array<() => void> = [];
async function open(): Promise<void> {
  let generation = 0;
  wire.request.mockImplementation(async (method: string) =>
    method === 'chat.subscribe' ? { subscriptionId: `sub-${++generation}` } : {},
  );
  store.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        workspaceId: WS,
        name: 'Sleep regression',
        status: AgentStatus.Active,
        messages: [],
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
      } as AgentSession,
    ]),
  );
  stops.push(store.runSaga(chatSubscribeSaga), store.runSaga(chatScrollbackSaga));
  store.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
  await flush();
  expect(wire.request).toHaveBeenCalledWith('chat.subscribe', {
    agentId: AGENT,
    workspaceId: WS,
    deltaEncoding: 'incremental',
    projection: 'slim',
    historyDelivery: 'progressive',
  });
}
async function reconnect(): Promise<void> {
  for (const handler of wire.reconnects) handler();
  await flush();
}

describe('chat reconnect recovery through the live client and store', () => {
  beforeAll(() => store.init());
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    store.dispatch(clearAllSessions());
    wire.notifications.clear();
    wire.reconnects.clear();
    vi.clearAllMocks();
  });

  it('does not restart a progressive burst when session hydration catches up', async () => {
    await open();
    snapshot('sub-1', [message('m-11', 11)], {
      historyDelivery: 'progressive',
      totalMessages: 12,
      initialHistory: { target: 20, received: 1, complete: false },
    });
    for (let received = 2; received <= 12; received++) {
      for (const handler of wire.notifications)
        handler({
          method: 'subscription.push',
          params: {
            subscriptionId: 'sub-1',
            kind: 'history',
            seq: received - 1,
            history: {
              target: 20,
              received,
              complete: false,
              message: message(`m-${12 - received}`, 12 - received),
            },
          },
        });
    }
    vi.mocked(appClient.agents.get).mockResolvedValue(
      selectAgentSession.select(store.state, AGENT),
    );
    stops.push(store.runSaga(chatReadSaga));
    store.dispatch(refreshChatTranscriptRequested(WS, AGENT));
    await flush();
    expect(wire.request.mock.calls.filter(([method]) => method === 'chat.subscribe')).toHaveLength(
      1,
    );
    expect(selectChatAgentState.select(store.state, AGENT)).toMatchObject({
      initialHistoryPending: true,
      initialHistory: { received: 12, complete: false },
      transcriptHydration: 'loading',
    });
    for (const handler of wire.notifications)
      handler({
        method: 'subscription.push',
        params: {
          subscriptionId: 'sub-1',
          kind: 'history',
          seq: 12,
          history: {
            target: 20,
            received: 12,
            complete: true,
            nextToken: null,
            truncated: false,
            totalMessages: 12,
          },
        },
      });
    await flush();
    expect(selectChatAgentState.select(store.state, AGENT).transcriptHydration).toBe('settled');
    expect(rows()).toHaveLength(12);
  });

  it('removes an evicted pre-sleep partial from the tail and retrieves its canonical row through scrollback', async () => {
    await open();
    snapshot('sub-1', [message('user-before', 0), message('old-partial')]);
    expect(rows().at(-1)).toMatchObject({ id: 'old-partial', isStreaming: true });

    // More than one newest page was persisted during sleep. This is the
    // bounded full snapshot the daemon serves without a sinceMessageId.
    const newestPage = Array.from({ length: 20 }, (_, index) =>
      message(`missed-${index + 4}`, index + 4),
    );
    await reconnect();
    snapshot('sub-2', newestPage, {
      truncated: true,
      totalMessages: 24,
      nextToken: 'older-than-4',
    });

    // No send or history refresh is needed to repair the displayed tail.
    expect(rows().map((row) => row.id)).toEqual(newestPage.map((row) => row.id));
    expect(selectTranscriptSnapshotMeta.select(store.state, AGENT)).toMatchObject({
      truncated: true,
      nextToken: 'older-than-4',
      totalMessages: 24,
    });
    expect(wire.request.mock.calls.filter(([method]) => method === 'chat.subscribe')).toEqual([
      [
        'chat.subscribe',
        {
          agentId: AGENT,
          workspaceId: WS,
          deltaEncoding: 'incremental',
          projection: 'slim',
          historyDelivery: 'progressive',
        },
      ],
      [
        'chat.subscribe',
        {
          agentId: AGENT,
          workspaceId: WS,
          deltaEncoding: 'incremental',
          projection: 'slim',
          historyDelivery: 'progressive',
        },
      ],
    ]);

    const older = [
      message('user-before', 0),
      message('old-partial', 1),
      ...Array.from({ length: 2 }, (_, index) => message(`missed-${index + 2}`, index + 2)),
    ];
    vi.mocked(appClient.agents.getConversation).mockResolvedValueOnce({
      messages: older,
      truncated: false,
      totalMessages: 24,
      nextToken: null,
    });
    store.dispatch(olderHistoryPageRequested(WS, AGENT));
    await flush();
    expect(appClient.agents.getConversation).toHaveBeenCalledWith(
      AGENT,
      5,
      'older-than-4',
      undefined,
      undefined,
      WS,
    );
    expect(selectAgentHistoryMessages.select(store.state, AGENT).map((row) => row.id)).toEqual(
      older.map((row) => row.id),
    );
    expect(rows().at(-1)?.id).toBe('missed-23');
  });

  it('adopts the old partial’s persisted sequence on reconnect and ignores obsolete pushes', async () => {
    await open();
    snapshot('sub-1', [message('user-before', 0), message('old-partial')]);
    await reconnect();
    const canonical = [message('user-before', 0), message('old-partial', 1), message('newer', 2)];
    snapshot('sub-2', canonical);
    expect(rows().map((row) => [row.id, row.seq])).toEqual([
      ['user-before', 0],
      ['old-partial', 1],
      ['newer', 2],
    ]);
    expect(rows().find((row) => row.id === 'old-partial')).toMatchObject({
      streamingComplete: true,
    });
    snapshot('sub-1', [message('old-partial')]);
    snapshot('sub-2', canonical);
    await reconnect();
    snapshot('sub-3', canonical);
    snapshot('sub-2', [message('old-partial')]);
    expect(rows().map((row) => row.id)).toEqual(['user-before', 'old-partial', 'newer']);
  });

  it('rejects an old history read that completes after the reconnect reset', async () => {
    await open();
    snapshot('sub-1', [message('before', 10)], {
      truncated: true,
      totalMessages: 11,
      nextToken: 'before-10',
    });
    let completePage!: (page: Awaited<ReturnType<typeof appClient.agents.getConversation>>) => void;
    vi.mocked(appClient.agents.getConversation).mockReturnValueOnce(
      new Promise((resolve) => {
        completePage = resolve;
      }),
    );
    store.dispatch(olderHistoryPageRequested(WS, AGENT));
    await flush();
    await reconnect();
    snapshot('sub-2', [message('after', 20)], {
      truncated: true,
      totalMessages: 21,
      nextToken: 'before-20',
    });
    completePage({
      messages: [message('stale-history', 9)],
      truncated: true,
      totalMessages: 11,
      nextToken: 'before-9',
    });
    await flush();
    expect(selectAgentHistoryMessages.select(store.state, AGENT)).toEqual([]);
    expect(selectChatAgentState.select(store.state, AGENT)).toMatchObject({
      scrollbackOlderToken: 'before-20',
      fetchingOlderHistory: false,
    });
    expect(rows().map((row) => row.id)).toEqual(['after']);
  });

  it.each([false, true])(
    'preserves pending-send activity through failed hydration retry (prior streaming: %s)',
    async (wasStreaming) => {
      await open();
      const canonical = [message('before', 0)];
      snapshot('sub-1', wasStreaming ? [...canonical, message('old-partial')] : canonical);
      stops.push(store.runSaga(chatReadSaga));
      vi.mocked(appClient.agents.get).mockRejectedValueOnce(
        new Error('temporary metadata read failure'),
      );
      await reconnect();
      store.dispatch(chatSendStarted(AGENT, WS));
      store.dispatch(
        addMessage(AGENT, {
          ...message('optimistic-send'),
          role: 'user',
          isStreaming: false,
          appMessageId: 'local-send-id',
        }),
      );
      snapshot('sub-2', canonical);
      await flush();
      await flush();
      expect(selectChatAgentState.select(store.state, AGENT).transcriptHydration).toBe('error');
      expect(selectAgentSession.select(store.state, AGENT)).toMatchObject({
        isStreaming: true,
        isProcessing: true,
      });

      let completeRead!: (session: AgentSession) => void;
      vi.mocked(appClient.agents.get).mockReturnValueOnce(
        new Promise((resolve) => {
          completeRead = resolve;
        }),
      );
      store.dispatch(refreshChatTranscriptRequested(WS, AGENT));
      await flush();
      expect(appClient.agents.get).toHaveBeenNthCalledWith(2, AGENT, WS);
      expect(rows().map((row) => row.id)).toEqual(['before', 'optimistic-send']);
      expect.soft(selectAgentSession.select(store.state, AGENT)).toMatchObject({
        isStreaming: true,
        isProcessing: true,
      });
      // agent.get returns daemon metadata, without renderer-only activity flags.
      // This stale idle read must not overwrite the local send while retry restores
      // the already-applied recovery snapshot.
      completeRead({
        id: AGENT,
        workspaceId: WS,
        name: 'Sleep regression',
        status: AgentStatus.Active,
        createdAt: '2026-10-06T00:00:00.000Z',
        updatedAt: '2026-10-06T00:00:00.000Z',
        messages: [],
        isResponding: false,
        turnInFlight: false,
        lastStreamActivityAt: null,
      } as AgentSession);
      await flush();
      await flush();
      expect(selectChatAgentState.select(store.state, AGENT).transcriptHydration).toBe('settled');
      expect(rows().map((row) => row.id)).toEqual(['before', 'optimistic-send']);
      expect.soft(selectAgentSession.select(store.state, AGENT)).toMatchObject({
        isStreaming: true,
        isProcessing: true,
      });
      expect(appClient.agents.get).toHaveBeenCalledTimes(2);
      expect(appClient.agents.getConversation).not.toHaveBeenCalled();
      expect(
        wire.request.mock.calls.filter(([method]) => method === 'chat.subscribe'),
      ).toHaveLength(2);

      const echo: BackendNotification = {
        method: 'subscription.push',
        params: {
          subscriptionId: 'sub-2',
          kind: 'delta',
          seq: 1,
          delta: {
            added: [
              {
                agentId: AGENT,
                messageId: 'canonical-send',
                role: 'user',
                messageSeq: 1,
                timestamp: '2026-10-06T01:00:01.000Z',
                streamingComplete: true,
                appMessageId: 'local-send-id',
                block: {
                  type: 'text',
                  id: 'canonical-send:0',
                  text: 'Content for optimistic-send',
                },
              },
            ],
            updated: [],
            removedIds: [],
          },
        },
      };
      for (const handler of wire.notifications) {
        handler(echo);
        handler(echo);
      }
      expect(rows().map((row) => [row.id, row.seq])).toEqual([
        ['before', 0],
        ['canonical-send', 1],
      ]);
      expect.soft(selectAgentSession.select(store.state, AGENT)).toMatchObject({
        isStreaming: true,
        isProcessing: true,
      });
      // A genuinely new idle snapshot still settles the pending activity.
      snapshot('sub-2', [...rows(), message('completed-reply', 2)]);
      expect(selectAgentSession.select(store.state, AGENT)).toMatchObject({
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      });
    },
  );

  it.each([
    { timing: 'before', wasStreaming: false },
    { timing: 'after', wasStreaming: false },
    { timing: 'before', wasStreaming: true },
  ])(
    'preserves a send started $timing recovery (prior streaming: $wasStreaming)',
    async ({ timing, wasStreaming }) => {
      await open();
      const canonical = [message('before', 0)];
      snapshot('sub-1', wasStreaming ? [...canonical, message('old-partial')] : canonical);
      // Hold the real refresh consumer's metadata read so a local send starts
      // between the recovery snapshot and hydration replay.
      stops.push(store.runSaga(chatReadSaga));
      let completeRead!: (session: AgentSession) => void;
      vi.mocked(appClient.agents.get).mockReturnValueOnce(
        new Promise((resolve) => {
          completeRead = resolve;
        }),
      );
      await reconnect();
      if (timing === 'after') snapshot('sub-2', canonical);
      const session = selectAgentSession.select(store.state, AGENT)!;
      store.dispatch(chatSendStarted(AGENT, WS));
      store.dispatch(
        addMessage(AGENT, {
          ...message('optimistic-send'),
          role: 'user',
          isStreaming: false,
          appMessageId: 'local-send-id',
        }),
      );
      if (timing === 'before') snapshot('sub-2', canonical);
      await flush();
      expect(appClient.agents.get).toHaveBeenCalledTimes(1);
      const beforeReadSettles = rows().map((row) => row.id);
      completeRead({ ...session, messages: [] });
      await flush();
      await flush();
      expect(beforeReadSettles).toEqual(['before', 'optimistic-send']);
      expect(rows().map((row) => row.id)).toEqual(['before', 'optimistic-send']);
      expect(selectAgentSession.select(store.state, AGENT)?.isStreaming).toBe(true);
      expect(appClient.agents.get).toHaveBeenCalledTimes(1);
      expect(appClient.agents.getConversation).not.toHaveBeenCalled();
      expect(
        wire.request.mock.calls.filter(([method]) => method === 'chat.subscribe'),
      ).toHaveLength(2);
      // The daemon's canonical echo replaces the preserved optimistic row by
      // logical identity; duplicate delivery does not create another bubble.
      const echo: BackendNotification = {
        method: 'subscription.push',
        params: {
          subscriptionId: 'sub-2',
          kind: 'delta',
          seq: 1,
          delta: {
            added: [
              {
                agentId: AGENT,
                messageId: 'canonical-send',
                role: 'user',
                messageSeq: 1,
                timestamp: '2026-10-06T01:00:01.000Z',
                streamingComplete: true,
                appMessageId: 'local-send-id',
                block: {
                  type: 'text',
                  id: 'canonical-send:0',
                  text: 'Content for optimistic-send',
                },
              },
            ],
            updated: [],
            removedIds: [],
          },
        },
      };
      for (const handler of wire.notifications) {
        handler(echo);
        handler(echo);
      }
      expect(rows().map((row) => row.id)).toEqual(['before', 'canonical-send']);
    },
  );
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, AgentSession } from '$shared/types';
import type { ChatLiveStreamPhase, ChatTranscript } from '$lib/client/app-client';

// FAKE seam: chat.subscribe is stubbed so no daemon call happens; each call
// records its handler (so tests can push §7.1-shaped reconciled transcripts
// through the saga-owned event channel)
// and returns a spy disposer. agents.get/getConversation keep the sibling
// chat-read saga (same initializeChatRequested trigger, real store) inert.
// READ-ONLY: never a mutation.
vi.mock('$lib/client', () => {
  const subscriptions: Array<{
    agentId: string;
    handler: (transcript: ChatTranscript) => void;
    onPhase?: (phase: string) => void;
    options?: { sinceMessageId?: string };
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    appClient: {
      agents: {
        get: vi.fn(() => Promise.resolve(null)),
        getConversation: vi.fn(() =>
          Promise.resolve({ messages: [], truncated: false, totalMessages: 0, nextToken: null }),
        ),
      },
      chat: {
        subscribe: vi.fn(
          (
            agentId: string,
            handler: (transcript: ChatTranscript) => void,
            onPhase?: (phase: string) => void,
            options?: { sinceMessageId?: string },
          ) => {
            const unsubscribe = vi.fn();
            subscriptions.push({ agentId, handler, onPhase, options, unsubscribe });
            return unsubscribe;
          },
        ),
      },
    },
    __chatSubscriptions: subscriptions,
  };
});

// Spy seam for the bridge stream-accumulator seeding (single-transfer
// hydration: the subscribe saga seeds it from the snapshot's in-flight
// assistant message).
vi.mock('$features/events/daemon-events-bridge.client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$features/events/daemon-events-bridge.client')>();
  return { ...actual, seedStreamFromSnapshot: vi.fn() };
});

import * as clientModule from '$lib/client';
import { appClient } from '$lib/client';
import { takeEvery } from 'typed-redux-saga';
import { store as appStore } from '$store/renderer/store';
import {
  chatSendStarted,
  chatTranscriptSnapshotRerequested,
  initializeChatRequested,
  refreshChatTranscriptRequested,
  transcriptHydrationFailed,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  addMessage,
  bulkUpsertSessions,
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { clearPanelLayout, openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectAwaitingSwitchBackSnapshot,
  selectChatLiveStreamPhase,
} from '$store/renderer/slices/chat-state/chat-state-selectors';
import {
  selectAgentMessages,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  clearCurrentlyViewedAgent,
  markAgentAsViewed,
} from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { chatSubscribeSaga, SWITCH_BACK_REVEAL_WAIT_MS } from './chat-subscribe-saga';
import {
  clearPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import {
  acquireChatInterestLease,
  clearAllChatInterestLeases,
  releaseChatInterestLease,
} from '$features/agent/utils/chat-interest-leases';
import {
  hasChatSubscriptionAcquisitionInFlight,
  hasReplayableChatSnapshot,
  hasStandingChatSubscription,
} from '$features/agent/utils/chat-subscription-registry';
import { seedStreamFromSnapshot } from '$features/events/daemon-events-bridge.client';
import { selectTranscriptSnapshotMeta } from '$store/renderer/slices/chat-state/chat-state-selectors';
import { shouldShowStoppedIndicator } from '$lib/components/chat/message-display-utils';

type FakeSubscription = {
  agentId: string;
  handler: (transcript: ChatTranscript) => void;
  onPhase?: (phase: ChatLiveStreamPhase) => void;
  options?: { sinceMessageId?: string };
  unsubscribe: ReturnType<typeof vi.fn>;
};

const fakeSubscriptions = (clientModule as unknown as { __chatSubscriptions: FakeSubscription[] })
  .__chatSubscriptions;
const chatApi = appClient.chat as unknown as { subscribe: ReturnType<typeof vi.fn> };

const WS = 'ws-chat-sub-1';

function makeSession(agentId: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: agentId,
    backendSessionId: null,
    workspaceId: WS,
    name: 'Agent Sub',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

function makeMessage(
  id: string,
  text: string,
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2026-01-01T00:00:01.000Z',
    contentBlocks: [{ type: 'text', id: `${id}:0`, text }],
    ...overrides,
  };
}

function transcript(messages: AgentMessage[], isStreaming = false): ChatTranscript {
  return { messages, truncated: false, totalMessages: messages.length, isStreaming };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function delayNextSubscription(agentId: string): {
  acquisition: ReturnType<typeof deferred<() => void>>;
  subscription: FakeSubscription;
} {
  const acquisition = deferred<() => void>();
  const unsubscribe = vi.fn();
  let subscription: FakeSubscription | undefined;
  chatApi.subscribe.mockImplementationOnce(
    (
      subscribedAgentId: string,
      handler: (value: ChatTranscript) => void,
      onPhase?: (phase: ChatLiveStreamPhase) => void,
    ) => {
      expect(subscribedAgentId).toBe(agentId);
      subscription = { agentId, handler, onPhase, unsubscribe };
      fakeSubscriptions.push(subscription);
      return acquisition.promise;
    },
  );
  appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
  expect(chatApi.subscribe).toHaveBeenLastCalledWith(
    agentId,
    expect.any(Function),
    expect.any(Function),
  );
  if (!subscription) throw new Error(`no delayed chat.subscribe recorded for ${agentId}`);
  return { acquisition, subscription };
}

function seedSession(agentId: string, overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(bulkUpsertSessions([makeSession(agentId, overrides)]));
}

function openChat(agentId: string): FakeSubscription {
  appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
  const sub = fakeSubscriptions.find((s) => s.agentId === agentId);
  if (!sub) throw new Error(`no chat.subscribe recorded for ${agentId}`);
  return sub;
}

describe('chatSubscribeSaga (fake seam, real store)', () => {
  let stopSaga: (() => void) | undefined;

  beforeAll(() => {
    appStore.init();
    stopSaga = appStore.runSaga(chatSubscribeSaga);
  });
  afterAll(() => stopSaga?.());
  afterEach(() => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(clearPanelLayout(WS));
    clearPendingAgentDeletions();
    clearAllChatInterestLeases();
    fakeSubscriptions.length = 0;
    vi.clearAllMocks();
  });

  it('initializeChatRequested opens exactly one standing subscription per agent', () => {
    const agentId = 'agent-sub-open';
    seedSession(agentId);
    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));

    const calls = chatApi.subscribe.mock.calls.filter(([id]) => id === agentId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(agentId);
  });

  it('closes standing subscriptions when the root saga is cancelled', () => {
    const agentId = 'agent-sub-cancel';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));
    const before = selectAgentMessages.select(appStore.state, agentId);

    stopSaga?.();
    stopSaga = undefined;

    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    sub.handler(transcript([makeMessage('late-after-cancel', 'stale')]));
    expect(selectAgentMessages.select(appStore.state, agentId)).toBe(before);
    stopSaga = appStore.runSaga(chatSubscribeSaga);
  });

  it('disposes a subscription acquired after root cancellation exactly once', async () => {
    const agentId = 'agent-sub-cancel-pending';
    seedSession(agentId);
    const { acquisition, subscription } = delayNextSubscription(agentId);

    stopSaga?.();
    stopSaga = undefined;
    acquisition.resolve(subscription.unsubscribe);

    await vi.waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
    subscription.handler(transcript([makeMessage('late-pending-root', 'stale')]));
    expect(selectAgentMessages.select(appStore.state, agentId)).toEqual([]);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    stopSaga = appStore.runSaga(chatSubscribeSaga);
  });

  it.each([
    {
      name: 'scoped clear',
      prepare: (agentId: string) => appStore.dispatch(markAgentAsViewed(agentId)),
      close: (agentId: string) => appStore.dispatch(clearCurrentlyViewedAgent(agentId)),
    },
    {
      name: 'session removal',
      close: (agentId: string) => appStore.dispatch(removeSession(agentId)),
    },
    {
      name: 'workspace session removal',
      close: () => appStore.dispatch(removeWorkspaceSessions(WS)),
    },
    {
      name: 'workspace deletion',
      close: (agentId: string) => appStore.dispatch(workspaceDeleted(WS, [agentId])),
    },
    {
      name: 'clear all',
      close: () => appStore.dispatch(clearAllSessions()),
    },
  ])(
    'disposes a late-acquired subscription after $name and rejects queued hydration/events',
    async ({ name, prepare, close }) => {
      appStore.dispatch(clearCurrentlyViewedAgent());
      const agentId = `agent-sub-late-${name.replaceAll(' ', '-')}`;
      seedSession(agentId);
      const { acquisition, subscription } = delayNextSubscription(agentId);
      prepare?.(agentId);

      subscription.handler(transcript([makeMessage('late-before-close', 'stale')], true));
      subscription.onPhase?.('connecting');
      appStore.dispatch(transcriptHydrationSettled(agentId));
      close(agentId);
      subscription.handler(transcript([makeMessage('late-after-close', 'stale')], true));
      acquisition.resolve(subscription.unsubscribe);

      await vi.waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
      subscription.handler(transcript([makeMessage('late-after-acquire', 'stale')], true));
      subscription.onPhase?.('delayed');
      await Promise.resolve();

      expect(
        selectAgentMessages.select(appStore.state, agentId).map((message) => message.id),
      ).not.toContain('late-before-close');
      expect(
        selectAgentMessages.select(appStore.state, agentId).map((message) => message.id),
      ).not.toContain('late-after-close');
      expect(
        selectAgentMessages.select(appStore.state, agentId).map((message) => message.id),
      ).not.toContain('late-after-acquire');
      expect(selectChatLiveStreamPhase.select(appStore.state, agentId)).toBeNull();
      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    },
  );

  it('serializes delayed unsubscribe before reopening the same agent while another agent opens independently', async () => {
    const agentA = 'agent-sub-delayed-close-a';
    const agentB = 'agent-sub-delayed-close-b';
    seedSession(agentA);
    const firstA = openChat(agentA);
    const close = deferred<void>();
    firstA.unsubscribe.mockReturnValueOnce(close.promise);

    appStore.dispatch(removeSession(agentA));
    seedSession(agentA);
    appStore.dispatch(initializeChatRequested(agentA, { wsId: WS }));

    seedSession(agentB);
    appStore.dispatch(initializeChatRequested(agentB, { wsId: WS }));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentA)).toHaveLength(1);
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentB)).toHaveLength(1);

    close.resolve();
    await vi.waitFor(() => {
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentA)).toHaveLength(2);
    });
    expect(firstA.unsubscribe).toHaveBeenCalledOnce();
  });

  it('opens each superseding viewed agent immediately without waiting on a prior delayed unsubscribe', async () => {
    const agentA = 'agent-sub-view-race-a';
    const agentB = 'agent-sub-view-race-b';
    const agentC = 'agent-sub-view-race-c';
    seedSession(agentA);
    seedSession(agentB);
    seedSession(agentC);
    const subA = openChat(agentA);
    appStore.dispatch(markAgentAsViewed(agentA));
    const close = deferred<void>();
    subA.unsubscribe.mockReturnValueOnce(close.promise);

    // Each swap's subscribe goes on the wire immediately: A's delayed
    // unsubscribe never gates B's open, and C's swap sweeps B and opens C
    // right away (chat.subscribe registrations are agent-independent, §7.1).
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentB)).toHaveLength(1);
    expect(subA.unsubscribe).toHaveBeenCalledOnce();
    const subB = fakeSubscriptions.find((s) => s.agentId === agentB)!;

    appStore.dispatch(markAgentAsViewed(agentC));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentC)).toHaveLength(1);
    expect(subB.unsubscribe).toHaveBeenCalledOnce();

    close.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(subA.unsubscribe).toHaveBeenCalledOnce();

    const before = selectAgentMessages.select(appStore.state, agentA);
    subA.handler(transcript([makeMessage('late-view-race', 'stale')]));
    expect(selectAgentMessages.select(appStore.state, agentA)).toBe(before);
  });

  it('queues a same-agent re-view reopen behind its own delayed unsubscribe while the swapped-in agent opened immediately', async () => {
    const agentA = 'agent-sub-review-order-a';
    const agentB = 'agent-sub-review-order-b';
    seedSession(agentA);
    seedSession(agentB);
    const subA = openChat(agentA);
    appStore.dispatch(markAgentAsViewed(agentA));
    const close = deferred<void>();
    subA.unsubscribe.mockReturnValueOnce(close.promise);

    // Swap A → B: B's subscribe is immediate, A's close is in flight.
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentB)).toHaveLength(1);
    expect(subA.unsubscribe).toHaveBeenCalledOnce();

    // Swap back B → A: A's reopen MUST queue behind A's own pending close
    // (same-agent close→open ordering through the slot channel).
    appStore.dispatch(markAgentAsViewed(agentA));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentA)).toHaveLength(1);

    close.resolve();
    await vi.waitFor(() => {
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentA)).toHaveLength(2);
    });
    expect(subA.unsubscribe).toHaveBeenCalledOnce();
  });

  it('hydrates the transcript from the seq-0 snapshot emit and live-updates on delta emits', () => {
    const agentId = 'agent-sub-hydrate';
    seedSession(agentId);
    const sub = openChat(agentId);

    // seq-0 snapshot emit: user + assistant page.
    const user = makeMessage('0190a1b2-user', 'Run the tests', {
      role: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const asst = makeMessage('0190a200-asst', 'Let me check.');
    sub.handler(transcript([user, asst]));

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      '0190a1b2-user',
      '0190a200-asst',
    ]);

    // Delta emit: the assistant block grew (reconciler emits the full list).
    const grown = makeMessage('0190a200-asst', 'Let me check the logs first.');
    sub.handler(transcript([user, grown], true));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    expect(messages.map((m) => m.id)).toEqual(['0190a1b2-user', '0190a200-asst']);
    expect(messages[1].contentBlocks?.[0]).toMatchObject({
      text: 'Let me check the logs first.',
    });
  });

  it('records snapshot metadata on fromSnapshot emits (single-transfer hydration signal)', () => {
    const agentId = 'agent-sub-snapmeta';
    seedSession(agentId);
    const sub = openChat(agentId);

    sub.handler({
      ...transcript([makeMessage('m-oldest', 'first'), makeMessage('m-newest', 'second')]),
      truncated: true,
      totalMessages: 7,
      fromSnapshot: true,
    });

    const meta = selectTranscriptSnapshotMeta.select(appStore.state, agentId);
    expect(meta).toMatchObject({
      truncated: true,
      totalMessages: 7,
      oldestMessageId: 'm-oldest',
      seq: 1,
    });

    // Delta emits do NOT touch the metadata.
    sub.handler(transcript([makeMessage('m-oldest', 'first'), makeMessage('m-newest', 'grown')]));
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);

    // A later snapshot (gap resnapshot / reconnect) bumps the seq.
    sub.handler({
      ...transcript([makeMessage('m-newest', 'second')]),
      fromSnapshot: true,
    });
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toMatchObject({
      truncated: false,
      oldestMessageId: 'm-newest',
      seq: 2,
    });
  });

  it("seeds the stream accumulator from the snapshot's in-flight assistant message", () => {
    const agentId = 'agent-sub-seed';
    seedSession(agentId);
    const sub = openChat(agentId);

    const inFlight = makeMessage('m-inflight', 'partial...', {
      isStreaming: true,
    } as Partial<AgentMessage>);
    sub.handler({
      ...transcript([makeMessage('m-done', 'done'), inFlight], true),
      fromSnapshot: true,
    });

    expect(seedStreamFromSnapshot).toHaveBeenCalledWith(agentId, inFlight, WS);

    // No in-flight message → no seeding.
    vi.mocked(seedStreamFromSnapshot).mockClear();
    sub.handler({ ...transcript([makeMessage('m-done', 'done')]), fromSnapshot: true });
    expect(seedStreamFromSnapshot).not.toHaveBeenCalled();

    // A stray isStreaming flag on a non-assistant row never seeds.
    sub.handler({
      ...transcript([
        makeMessage('m-user-stray', 'user text', {
          role: 'user',
          isStreaming: true,
        } as Partial<AgentMessage>),
      ]),
      fromSnapshot: true,
    });
    expect(seedStreamFromSnapshot).not.toHaveBeenCalled();
  });

  // Ordering lock (atomic first-paint): the chat-read saga settles hydration
  // (the reveal gate) on `chatTranscriptSnapshotApplied`, so that action must
  // be dispatched only AFTER the snapshot's messages replaced the store rows
  // AND the stream accumulator was seeded from the in-flight assistant
  // message — otherwise the reveal frame could miss the live turn.
  it('dispatches chatTranscriptSnapshotApplied only after messages applied and stream seeded', () => {
    const agentId = 'agent-sub-order';
    seedSession(agentId);
    const sub = openChat(agentId);

    const observedAtSeed: {
      messageIds: string[];
      metaRecorded: boolean;
    }[] = [];
    vi.mocked(seedStreamFromSnapshot).mockImplementationOnce(() => {
      observedAtSeed.push({
        messageIds: selectAgentMessages.select(appStore.state, agentId).map((m) => m.id),
        metaRecorded: selectTranscriptSnapshotMeta.select(appStore.state, agentId) !== undefined,
      });
    });

    const inFlight = makeMessage('m-order-live', 'partial...', {
      isStreaming: true,
    } as Partial<AgentMessage>);
    sub.handler({
      ...transcript([makeMessage('m-order-user', 'question', { role: 'user' }), inFlight], true),
      fromSnapshot: true,
    });

    // At seed time the snapshot messages were already in the store, but the
    // snapshot-applied signal had NOT yet been recorded.
    expect(observedAtSeed).toEqual([
      { messageIds: ['m-order-user', 'm-order-live'], metaRecorded: false },
    ]);
    // The applied signal followed the seed.
    expect(seedStreamFromSnapshot).toHaveBeenCalledOnce();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toMatchObject({
      totalMessages: 2,
      seq: 1,
    });
  });

  // Regression (PR #1327 finding 1): the seq-0 snapshot can beat the
  // chat-read saga's `agents.get` (both start on initializeChatRequested).
  // Applying it pre-session would record snapshot meta with NO store rows to
  // back it (applyTranscript no-ops without a session), stranding the read
  // saga on a second snapshot that never comes. The snapshot must instead be
  // deferred whole and replayed on the session shell's upsert — meta and
  // messages land together.
  it('defers a pre-session seq-0 snapshot and replays it on the session upsert', async () => {
    const agentId = 'agent-sub-presession';
    // No seedSession: the snapshot arrives before agents.get resolves.
    const sub = openChat(agentId);

    sub.handler({
      ...transcript([makeMessage('m-pre-1', 'one'), makeMessage('m-pre-2', 'two')]),
      fromSnapshot: true,
    });

    // Held back in full: no meta recorded, no rows written.
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toBeUndefined();
    expect(selectAgentMessages.select(appStore.state, agentId)).toEqual([]);

    // The read saga's shell upsert lands → the deferred snapshot replays.
    seedSession(agentId);
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toMatchObject({
        totalMessages: 2,
        seq: 1,
      });
    });
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-pre-1',
      'm-pre-2',
    ]);
  });

  it('replays the newest deferred delta after the pre-session snapshot on session upsert', async () => {
    const agentId = 'agent-sub-presession-delta';
    const sub = openChat(agentId);

    sub.handler({ ...transcript([makeMessage('m-a', 'a')]), fromSnapshot: true });
    // Deltas that also arrived pre-session (no-ops at the time).
    sub.handler(transcript([makeMessage('m-a', 'a'), makeMessage('m-b', 'b')]));
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toBeUndefined();

    seedSession(agentId);
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
    });
    // The store ends on the newest reconciled transcript, not the snapshot.
    await vi.waitFor(() => {
      expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
        'm-a',
        'm-b',
      ]);
    });
  });

  // Regression (PR #1327 review): the error surface's retry dispatches
  // refreshChatTranscriptRequested, which only re-entered the read saga's
  // bounded wait — against a registration that would never (re-)emit, the
  // retry looped error → wait → error forever. When hydration sits in
  // error, the subscribe saga must give the wait something to settle on.
  it('manual retry force-cycles a dead registration into a fresh chat.subscribe', async () => {
    const agentId = 'agent-sub-retry-dead';
    seedSession(agentId);
    const sub = openChat(agentId);
    // The registration never emitted a snapshot; the bounded wait failed.
    appStore.dispatch(transcriptHydrationStarted(agentId));
    appStore.dispatch(transcriptHydrationFailed(agentId));

    appStore.dispatch(refreshChatTranscriptRequested(WS, agentId));

    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(2);
    });
    // The fresh registration's seq-0 snapshot heals the transcript.
    const healed = fakeSubscriptions.filter((s) => s.agentId === agentId).at(-1)!;
    healed.handler({ ...transcript([makeMessage('m-healed', 'ok')]), fromSnapshot: true });
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
    });
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-healed',
    ]);
  });

  it('manual retry re-applies the last reconciled snapshot without cycling the registration', async () => {
    const agentId = 'agent-sub-retry-reapply';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler({ ...transcript([makeMessage('m-r1', 'one')]), fromSnapshot: true });
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
    // Hydration failed anyway (e.g. the snapshot applied after the wait
    // closed on a slower machine).
    appStore.dispatch(transcriptHydrationFailed(agentId));

    appStore.dispatch(refreshChatTranscriptRequested(WS, agentId));

    // Re-applied through the same event pipeline: meta re-records (seq
    // bumps), giving the read saga's re-entered wait a fresh application.
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(2);
    });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(1);
  });

  it('ignores refreshChatTranscriptRequested outside the error state (no registration cycling)', async () => {
    const agentId = 'agent-sub-retry-noop';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler({ ...transcript([makeMessage('m-n1', 'one')]), fromSnapshot: true });
    appStore.dispatch(transcriptHydrationStarted(agentId));
    appStore.dispatch(transcriptHydrationSettled(agentId));

    // The §7.1 resumed:false rehydration dispatches this same action right
    // after its snapshot applied — it must never cycle the registration.
    appStore.dispatch(refreshChatTranscriptRequested(WS, agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(1);
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
  });

  // Regression (intent-hq/monorepo#2692): the chat-read saga's bounded wait
  // timed out a window mid-hydration and dispatches
  // chatTranscriptSnapshotRerequested — the subscribe saga must give the next
  // window something to settle on while hydration still sits in `loading`.
  it('snapshot re-request force-cycles a silent registration while hydration is loading', async () => {
    const agentId = 'agent-sub-rereq-cycle';
    seedSession(agentId);
    const sub = openChat(agentId);
    // The registration never emitted a snapshot; the first wait window
    // timed out but hydration has NOT failed yet.
    appStore.dispatch(transcriptHydrationStarted(agentId));

    appStore.dispatch(chatTranscriptSnapshotRerequested(WS, agentId));

    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(2);
    });
    // The fresh registration's seq-0 snapshot heals the transcript.
    const healed = fakeSubscriptions.filter((s) => s.agentId === agentId).at(-1)!;
    healed.handler({ ...transcript([makeMessage('m-rereq', 'ok')]), fromSnapshot: true });
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
    });
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-rereq',
    ]);
  });

  it('snapshot re-request re-emits the last reconciled snapshot without cycling the registration', async () => {
    const agentId = 'agent-sub-rereq-reapply';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler({ ...transcript([makeMessage('m-rr1', 'one')]), fromSnapshot: true });
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
    // The snapshot applied but the read saga's wait missed it (e.g. it
    // applied between windows); hydration still sits in loading.
    appStore.dispatch(transcriptHydrationStarted(agentId));

    appStore.dispatch(chatTranscriptSnapshotRerequested(WS, agentId));

    // Re-applied through the same event pipeline: meta re-records (seq
    // bumps), giving the read saga's next window a fresh application.
    await vi.waitFor(() => {
      expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(2);
    });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(1);
  });

  it('ignores a snapshot re-request outside the loading state (no registration cycling)', async () => {
    const agentId = 'agent-sub-rereq-noop';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler({ ...transcript([makeMessage('m-rn1', 'one')]), fromSnapshot: true });
    appStore.dispatch(transcriptHydrationStarted(agentId));
    appStore.dispatch(transcriptHydrationSettled(agentId));

    // A stale re-request delivered after hydration settled (or failed) must
    // never cycle a healthy registration.
    appStore.dispatch(chatTranscriptSnapshotRerequested(WS, agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(1);
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);
  });

  it('discards retained store-only rows on a resumed: false fallback snapshot (§7.1)', () => {
    const agentId = 'agent-sub-resume-discard';
    // Retained history from a prior view: rows the daemon may since have
    // pruned past — they can sit BELOW an interior gap toward the served
    // newest page.
    seedSession(agentId, {
      messages: [makeMessage('m-retained-1', 'old1'), makeMessage('m-retained-2', 'old2')],
    });
    const sub = openChat(agentId);

    sub.handler({
      ...transcript([makeMessage('m-new-1', 'newest page')], false),
      truncated: true,
      totalMessages: 9,
      fromSnapshot: true,
      resumed: false,
    });

    // Retained rows are gone — the protocol mandates discarding the cached
    // transcript; the background walk refetches real history from the
    // snapshot window's oldest row.
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-new-1',
    ]);

    // A resumed: true snapshot (or plain delta) still preserves store-only rows.
    seedSession(agentId, {
      messages: [makeMessage('m-kept', 'kept'), makeMessage('m-new-1', 'newest page')],
    });
    sub.handler({
      ...transcript([makeMessage('m-new-2', 'after anchor')]),
      fromSnapshot: true,
      resumed: true,
    });
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-kept',
      'm-new-1',
      'm-new-2',
    ]);
  });

  it('dedups the optimistic user row against the canonical copy by appMessageId', () => {
    const agentId = 'agent-sub-optimistic';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    // Optimistic append (agent-send path): renderer-minted id +
    // client appMessageId.
    const appMessageId = 'app-msg-opt-1';
    appStore.dispatch(
      addMessage(agentId, {
        id: 'renderer-minted-user',
        appMessageId,
        role: 'user',
        timestamp: '2026-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      }),
    );

    // Daemon echoes the persisted user row with the same appMessageId lifted
    // (PROTOCOL §5.5 userAppMessageId) under the canonical row id.
    const canonical: AgentMessage = {
      id: 'msg_canonical-user-1',
      appMessageId,
      role: 'user',
      timestamp: '2026-01-01T00:00:02.100Z',
      contentBlocks: [{ type: 'text', id: 'msg_canonical-user-1:0', text: 'hello' }],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe('msg_canonical-user-1');
    expect(userRows[0].appMessageId).toBe(appMessageId);
  });

  it('dedups the optimistic user row by appMessageId even when the canonical content differs (§7.1 delta path)', () => {
    // intentd#781: the daemon echoes appMessageId on §7.1 user-row deltas, so
    // the reconciled canonical copy carries the client-minted logical id.
    // Exact appMessageId matching wins over every content heuristic — the
    // rows collapse even when the daemon-persisted content was normalized
    // and no longer hashes equal to the optimistic copy.
    const agentId = 'agent-sub-optimistic-appid-diff';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    const appMessageId = 'app-msg-opt-3';
    appStore.dispatch(
      addMessage(agentId, {
        id: '0190bbbb-optimistic-user',
        appMessageId,
        role: 'user',
        timestamp: '2026-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'deploy now\r\n' }],
      }),
    );

    // Canonical delta echo: server-minted user-msg id, SAME appMessageId,
    // daemon-normalized content (differs from the optimistic copy).
    const canonical: AgentMessage = {
      id: 'user-msg-aaaa1111-2222-3333-4444-555566667777',
      appMessageId,
      role: 'user',
      timestamp: '2026-01-01T00:00:02.100Z',
      contentBlocks: [
        {
          type: 'text',
          id: 'user-msg-aaaa1111-2222-3333-4444-555566667777:0',
          text: 'deploy now',
        },
      ],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe('user-msg-aaaa1111-2222-3333-4444-555566667777');
    expect(userRows[0].appMessageId).toBe(appMessageId);
  });

  it('keeps identical-content sends distinct when their appMessageIds differ (§7.1 delta path)', () => {
    // Two messages with the SAME text sent in quick succession are distinct
    // logical messages: each optimistic row and each canonical echo carries
    // its own appMessageId, so id matching pairs them one-to-one and the
    // content fallback (gated off when both sides carry an appMessageId)
    // never collapses them into one row.
    const agentId = 'agent-sub-identical-content';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    for (const [rendererId, appMessageId] of [
      ['0190cccc-optimistic-a', 'app-msg-same-a'],
      ['0190cccc-optimistic-b', 'app-msg-same-b'],
    ] as const) {
      appStore.dispatch(
        addMessage(agentId, {
          id: rendererId,
          appMessageId,
          role: 'user',
          timestamp: '2026-01-01T00:00:02.000Z',
          contentBlocks: [{ type: 'text', text: 'run it again' }],
        }),
      );
    }

    // First echo lands alone: it must collapse ONLY its own optimistic row.
    const canonicalA: AgentMessage = {
      id: 'user-msg-aaaa0000-1111-2222-3333-444444444444',
      appMessageId: 'app-msg-same-a',
      role: 'user',
      timestamp: '2026-01-01T00:00:02.050Z',
      contentBlocks: [
        {
          type: 'text',
          id: 'user-msg-aaaa0000-1111-2222-3333-444444444444:0',
          text: 'run it again',
        },
      ],
    };
    sub.handler(transcript([canonicalA]));

    let userRows = selectAgentMessages
      .select(appStore.state, agentId)
      .filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(2);
    expect(userRows.map((m) => m.appMessageId).sort()).toEqual([
      'app-msg-same-a',
      'app-msg-same-b',
    ]);

    // Second echo arrives: both rows are canonical, still two messages.
    const canonicalB: AgentMessage = {
      id: 'user-msg-bbbb0000-1111-2222-3333-444444444444',
      appMessageId: 'app-msg-same-b',
      role: 'user',
      timestamp: '2026-01-01T00:00:02.150Z',
      contentBlocks: [
        {
          type: 'text',
          id: 'user-msg-bbbb0000-1111-2222-3333-444444444444:0',
          text: 'run it again',
        },
      ],
    };
    sub.handler(transcript([canonicalA, canonicalB]));

    userRows = selectAgentMessages.select(appStore.state, agentId).filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(2);
    expect(userRows.map((m) => m.id)).toEqual([
      'user-msg-aaaa0000-1111-2222-3333-444444444444',
      'user-msg-bbbb0000-1111-2222-3333-444444444444',
    ]);
  });

  it('dedups the optimistic user row against a canonical user-msg echo lacking appMessageId (§7.1 delta path)', () => {
    // Version-skew fallback: an OLDER daemon's §7.1 user-row delta carries no
    // appMessageId, so the reconciled canonical copy arrives with only its
    // server-minted `user-msg-{uuid}` id. The optimistic row must still
    // collapse against it (content fallback recognizes the daemon-canonical
    // user-msg id), or every normal send — including structured-question
    // Q:/A: answers, which take the same send path — renders twice until a
    // refresh. The same shape applies to both, so one test covers them.
    const agentId = 'agent-sub-optimistic-no-appid';
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    appStore.dispatch(
      addMessage(agentId, {
        id: '0190aaaa-optimistic-user',
        appMessageId: 'app-msg-opt-2',
        role: 'user',
        timestamp: '2026-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'Q: Deploy now?\nA: Yes' }],
      }),
    );

    // The delta-path echo: canonical daemon row id, same content, NO
    // appMessageId (entity_with_role does not include it).
    const canonical: AgentMessage = {
      id: 'user-msg-7c1f4e0a-1111-2222-3333-444455556666',
      role: 'user',
      timestamp: '2026-01-01T00:00:02.100Z',
      contentBlocks: [
        {
          type: 'text',
          id: 'user-msg-7c1f4e0a-1111-2222-3333-444455556666:0',
          text: 'Q: Deploy now?\nA: Yes',
        },
      ],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe('user-msg-7c1f4e0a-1111-2222-3333-444455556666');
    // The optimistic side's logical id survives the merge.
    expect(userRows[0].appMessageId).toBe('app-msg-opt-2');
  });

  it('keeps the user row above the streaming assistant message when the daemon clock is skewed ahead (idle-send mis-ordering)', () => {
    // Regression test for the idle-send transient mis-ordering (mixed clock
    // domains on the ordering sort key). Sequence mirrors production:
    //   1. Optimistic user row — renderer clock (agent-send.ts), NO seq.
    //   2. Canonical user-row echo — daemon clock, skewed AHEAD (>1s beyond
    //      the USER_REPLY_ORDER_WINDOW_MS repair window), carrying the
    //      authoritative `seq` (§7.1 user-row deltas carry `messageSeq`).
    //      appMessageId dedup collapses the optimistic row onto it.
    //   3. First streamed chunk — §7.1 chunk deltas carry NO timestamp and
    //      NO messageSeq, so the reconciler creates the in-flight assistant
    //      message with a renderer-clock fallback (live-chat-client.ts
    //      upsertBlock), BEHIND the user row's daemon timestamp.
    // orderMessagesForConversation now sorts by daemon `seq` (single clock
    // domain); the seq-less in-flight message sorts AFTER every seq-bearing
    // row, so the user row stays above its streaming reply at every store
    // state regardless of skew.
    const agentId = 'agent-sub-clock-skew';
    seedSession(agentId);
    const sub = openChat(agentId);
    const prevAssistant = makeMessage('msg_prev-assistant', 'previous reply', {
      timestamp: '2026-01-01T00:00:00.000Z',
      seq: 4,
    });
    sub.handler(transcript([prevAssistant]));

    // 1. Optimistic user row (renderer clock at send, no seq yet).
    const appMessageId = 'app-msg-skew-1';
    appStore.dispatch(
      addMessage(agentId, {
        id: 'renderer-minted-user-skew',
        appMessageId,
        role: 'user',
        timestamp: '2026-01-01T00:00:02.000Z',
        contentBlocks: [{ type: 'text', text: 'follow up' }],
      }),
    );
    // The optimistic (seq-less) row renders after the seq-bearing history.
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'msg_prev-assistant',
      'renderer-minted-user-skew',
    ]);

    // 2. Canonical echo (message_row_delta re-read): daemon clock ~3.5s
    // ahead of the renderer, authoritative seq.
    const canonicalUser: AgentMessage = {
      id: 'user-msg-skew-1111-2222-3333-444455556666',
      appMessageId,
      role: 'user',
      timestamp: '2026-01-01T00:00:05.500Z',
      seq: 5,
      contentBlocks: [
        { type: 'text', id: 'user-msg-skew-1111-2222-3333-444455556666:0', text: 'follow up' },
      ],
    };
    sub.handler(transcript([prevAssistant, canonicalUser]));

    // 3. First chunk delta: no timestamp/messageSeq on the wire →
    // renderer-clock fallback at chunk arrival (~300ms after send on the
    // renderer clock), no seq until the terminal frame.
    const inFlight: AgentMessage = {
      id: 'msg_streaming-reply',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:02.300Z',
      isStreaming: true,
      contentBlocks: [{ type: 'text', id: 'msg_streaming-reply:0', text: 'On it' }],
    };
    sub.handler(transcript([prevAssistant, canonicalUser, inFlight], true));

    // The user row stays above its streaming reply.
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'msg_prev-assistant',
      'user-msg-skew-1111-2222-3333-444455556666',
      'msg_streaming-reply',
    ]);
  });

  it('corrects the skewed-clock inversion once the terminal frame stamps the daemon timestamp', () => {
    // Companion to the skew regression test above: the terminal §7.1 reconcile
    // stamps the assistant row with the authoritative daemon timestamp
    // (later than the user row's), so the sort self-corrects — the
    // "briefly, then corrects itself" half of the symptom.
    const agentId = 'agent-sub-clock-skew-corrected';
    seedSession(agentId);
    const sub = openChat(agentId);
    const prevAssistant = makeMessage('msg_prev-assistant-c', 'previous reply', {
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const canonicalUser: AgentMessage = {
      id: 'user-msg-skew-c-1111-2222-3333-444455556666',
      appMessageId: 'app-msg-skew-2',
      role: 'user',
      timestamp: '2026-01-01T00:00:05.500Z',
      contentBlocks: [
        { type: 'text', id: 'user-msg-skew-c-1111-2222-3333-444455556666:0', text: 'follow up' },
      ],
    };
    // Terminal frame adopted the persisted daemon timestamp for the reply.
    const settledReply: AgentMessage = {
      id: 'msg_streaming-reply-c',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:05.800Z',
      streamingComplete: true,
      contentBlocks: [{ type: 'text', id: 'msg_streaming-reply-c:0', text: 'On it' }],
    };
    sub.handler(transcript([prevAssistant, canonicalUser, settledReply]));

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'msg_prev-assistant-c',
      'user-msg-skew-c-1111-2222-3333-444455556666',
      'msg_streaming-reply-c',
    ]);
  });

  it('preserves store-only rows the snapshot page does not cover (older paged history)', () => {
    const agentId = 'agent-sub-paged';
    // Infinite scrollback (chat-scrollback saga) landed an older message the
    // newest snapshot page no longer includes.
    const older = makeMessage('older-page-msg', 'old history', {
      timestamp: '2025-12-31T23:00:00.000Z',
    });
    seedSession(agentId, { messages: [older] });
    const sub = openChat(agentId);

    const newest = makeMessage('newest-msg', 'recent');
    sub.handler(transcript([newest]));

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'older-page-msg',
      'newest-msg',
    ]);
  });

  it('edge-triggers streaming flags from transcript.isStreaming and never clobbers a fresh optimistic turn', () => {
    const agentId = 'agent-sub-flags';
    seedSession(agentId);
    const sub = openChat(agentId);

    // The renderer starts a new turn after the subscription opens. Its pending
    // seq-0 snapshot may predate the send, so the first idle snapshot must not
    // clear the optimistic flags.
    appStore.dispatch(chatSendStarted(agentId, WS));

    // First emit reports isStreaming=false (snapshot raced the turn start).
    // No falling edge has occurred — the optimistic flags must survive.
    sub.handler({ ...transcript([makeMessage('m-1', 'hi')]), fromSnapshot: true });
    let session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);

    // Rising edge: a live delta says the turn is in flight.
    sub.handler(transcript([makeMessage('m-1', 'hi there')], true));
    session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);

    // Falling edge: terminal frame — all responding flags clear.
    sub.handler(transcript([makeMessage('m-1', 'hi there!')], false));
    session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(false);
    expect(session?.isProcessing).toBe(false);
    expect(session?.isResponding).toBe(false);
  });

  it('clears retained HMR runtime flags from an authoritative idle seq-0 snapshot', () => {
    const agentId = 'agent-sub-hmr-idle';
    // Vite retains Redux while replacing the root sagas. The replacement
    // coordinator did not observe the old turn's chatSendStarted action.
    seedSession(agentId, {
      status: AgentStatus.Idle,
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
    });
    const sub = openChat(agentId);

    sub.handler({ ...transcript([makeMessage('m-final', 'done')]), fromSnapshot: true });

    expect(selectAgentSession.select(appStore.state, agentId)).toMatchObject({
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    });
  });

  it('clears a local send-race exemption when the subscription closes before any emit', () => {
    const agentId = 'agent-sub-detached-idle';
    seedSession(agentId, { status: AgentStatus.Idle });
    const first = openChat(agentId);
    appStore.dispatch(chatSendStarted(agentId, WS));
    expect(selectAgentSession.select(appStore.state, agentId)).toMatchObject({
      isStreaming: true,
      isProcessing: true,
    });

    // Detach before any snapshot/stream edge, then miss the terminal event.
    appStore.dispatch(clearCurrentlyViewedAgent());
    expect(first.unsubscribe).toHaveBeenCalledOnce();

    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
    const reopened = fakeSubscriptions.filter((sub) => sub.agentId === agentId).at(-1);
    expect(reopened).toBeDefined();
    expect(reopened).not.toBe(first);
    reopened!.handler({ ...transcript([makeMessage('m-final', 'done')]), fromSnapshot: true });

    expect(selectAgentSession.select(appStore.state, agentId)).toMatchObject({
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    });
  });

  it('swaps subscriptions on agent switch without leaking the previous registration', async () => {
    const agentA = 'agent-sub-switch-a';
    const agentB = 'agent-sub-switch-b';
    seedSession(agentA);
    seedSession(agentB);
    const subA = openChat(agentA);

    // Switching to B: ChatPanel dispatches markAgentAsViewed(B) (and its own
    // initializeChatRequested on mount).
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(subA.unsubscribe).toHaveBeenCalledTimes(1);
    // B's subscription opened from the switch (session already in store).
    await vi.waitFor(() => {
      expect(fakeSubscriptions.some((s) => s.agentId === agentB)).toBe(true);
    });
    const subB = fakeSubscriptions.find((s) => s.agentId === agentB);
    expect(subB).toBeDefined();

    // A late push from A's disposed registration must not write.
    const before = selectAgentMessages.select(appStore.state, agentA);
    subA.handler(transcript([makeMessage('late-a', 'stale')]));
    expect(selectAgentMessages.select(appStore.state, agentA)).toBe(before);
  });

  describe('resume via sinceMessageId (§7.1)', () => {
    it('opens the first subscription WITHOUT sinceMessageId (no hydrated transcript yet)', () => {
      const agentId = 'agent-sub-resume-first';
      seedSession(agentId, { messages: [makeMessage('m-existing', 'history')] });
      const sub = openChat(agentId);
      // Hydration never settled for this agent — full snapshot wanted.
      expect(sub.options).toBeUndefined();
    });

    it('re-subscribes with the last fully-persisted message id once hydration has settled', () => {
      const agentA = 'agent-sub-resume-a';
      const agentB = 'agent-sub-resume-b';
      const persisted = makeMessage('m-a-final', 'done');
      const streaming = makeMessage('m-a-partial', 'streaming…', { isStreaming: true });
      seedSession(agentA, { messages: [persisted, streaming] });
      seedSession(agentB);
      appStore.dispatch(transcriptHydrationStarted(agentA));
      appStore.dispatch(transcriptHydrationSettled(agentA));
      openChat(agentA);

      // Switch away (closes A's subscription), then back: the reopen must
      // anchor on the newest fully-persisted row — skipping the
      // still-streaming tail.
      appStore.dispatch(markAgentAsViewed(agentB));
      appStore.dispatch(markAgentAsViewed(agentA));

      const reopened = [...fakeSubscriptions].reverse().find((s) => s.agentId === agentA);
      expect(reopened).toBeDefined();
      expect(reopened!.options).toEqual({ sinceMessageId: 'm-a-final' });
    });

    it('clears the resume anchor when workspace deletion names an agent whose slot already retired', () => {
      const agentId = 'agent-sub-resume-retired-delete';
      const previous = makeMessage('m-before-delete', 'old workspace message');
      const recycled = makeMessage('m-after-recycle', 'new workspace message');
      seedSession(agentId, { messages: [previous] });
      appStore.dispatch(transcriptHydrationStarted(agentId));
      appStore.dispatch(transcriptHydrationSettled(agentId));
      const first = openChat(agentId);
      appStore.dispatch(markAgentAsViewed(agentId));

      appStore.dispatch(clearCurrentlyViewedAgent(agentId));
      expect(first.unsubscribe).toHaveBeenCalledOnce();
      appStore.dispatch(workspaceDeleted(WS, [agentId]));

      seedSession(agentId, { messages: [previous, recycled] });
      appStore.dispatch(transcriptHydrationStarted(agentId));
      appStore.dispatch(transcriptHydrationSettled(agentId));
      appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
      const reopened = [...fakeSubscriptions].reverse().find((sub) => sub.agentId === agentId);

      expect(reopened?.options).toEqual({ sinceMessageId: recycled.id });
    });

    it('clears an active-slot anchor when deletion queues behind a delayed ordinary close', async () => {
      const agentId = 'agent-sub-resume-active-delete';
      const previous = makeMessage('m-active-before-delete', 'old workspace message');
      const recycled = makeMessage('m-active-after-recycle', 'new workspace message');
      seedSession(agentId, { messages: [previous] });
      appStore.dispatch(transcriptHydrationStarted(agentId));
      appStore.dispatch(transcriptHydrationSettled(agentId));
      const first = openChat(agentId);
      const close = deferred<void>();
      first.unsubscribe.mockReturnValueOnce(close.promise);
      appStore.dispatch(markAgentAsViewed(agentId));

      appStore.dispatch(clearCurrentlyViewedAgent(agentId));
      appStore.dispatch(workspaceDeleted(WS, [agentId]));
      close.resolve();
      await vi.waitFor(() => expect(first.unsubscribe).toHaveBeenCalledOnce());

      seedSession(agentId, { messages: [previous, recycled] });
      appStore.dispatch(transcriptHydrationStarted(agentId));
      appStore.dispatch(transcriptHydrationSettled(agentId));
      appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
      await vi.waitFor(() => {
        expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(2);
      });
      const reopened = [...fakeSubscriptions].reverse().find((sub) => sub.agentId === agentId);

      expect(reopened?.options).toEqual({ sinceMessageId: recycled.id });
      expect(first.unsubscribe).toHaveBeenCalledOnce();
    });

    it('dispatches refreshChatTranscriptRequested when the daemon replies resumed: false', () => {
      const refreshes: Array<[string, string]> = [];
      const stopRecorder = appStore.runSaga(function* recorder() {
        yield* takeEvery(refreshChatTranscriptRequested, function* record(action) {
          refreshes.push(action.payload);
          yield;
        });
      });
      try {
        const agentId = 'agent-sub-resume-fallback';
        seedSession(agentId);
        const sub = openChat(agentId);

        // Fallback snapshot: the daemon did not honor the anchor. `resumed`
        // rides only snapshot emits, so `fromSnapshot` is always set with it.
        sub.handler({
          ...transcript([makeMessage('m-new', 'newest page')]),
          fromSnapshot: true,
          resumed: false,
        });

        expect(refreshes).toEqual([[WS, agentId]]);
      } finally {
        stopRecorder();
      }
    });

    it('does not trigger a rehydration on resumed: true or on plain emits', () => {
      const refreshes: Array<[string, string]> = [];
      const stopRecorder = appStore.runSaga(function* recorder() {
        yield* takeEvery(refreshChatTranscriptRequested, function* record(action) {
          refreshes.push(action.payload);
          yield;
        });
      });
      try {
        const agentId = 'agent-sub-resume-ok';
        seedSession(agentId);
        const sub = openChat(agentId);

        sub.handler({
          ...transcript([makeMessage('m-delta', 'delta rows')]),
          fromSnapshot: true,
          resumed: true,
        });
        sub.handler(transcript([makeMessage('m-delta', 'delta rows grown')], true));

        expect(refreshes).toEqual([]);
        // The resumed delta snapshot still applies to the store.
        expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
          'm-delta',
        ]);
      } finally {
        stopRecorder();
      }
    });
  });

  it('clears stale message-level streaming flags when a mid-turn subscription closes (navigate-away)', () => {
    // Viewed mid-turn then navigated away: the delta stream grew a message
    // with isStreaming: true, and nothing else rewrites it after the
    // subscription closes. The stale flag would keep the AgentCard tier-1
    // frozen buffer winning over the push-applied lastAgentResponse that IS
    // advancing (~1s activity pings), so subscription teardown normalizes
    // the flags on teardown.
    const agentA = 'agent-sub-stale-a';
    const agentB = 'agent-sub-stale-b';
    seedSession(agentA);
    seedSession(agentB);
    const subA = openChat(agentA);

    subA.handler(
      transcript([makeMessage('partial-a', 'streamed so far', { isStreaming: true })], true),
    );
    expect(
      selectAgentMessages.select(appStore.state, agentA).find((m) => m.id === 'partial-a')
        ?.isStreaming,
    ).toBe(true);

    // Navigate away mid-turn: markAgentAsViewed(B) closes A's subscription.
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(subA.unsubscribe).toHaveBeenCalledTimes(1);

    const partial = selectAgentMessages
      .select(appStore.state, agentA)
      .find((m) => m.id === 'partial-a');
    expect(partial?.isStreaming).toBe(false);
    expect(partial?.streamingComplete).toBe(true);
    // Content untouched — only the flags normalize.
    expect(partial?.contentBlocks?.[0]).toMatchObject({ text: 'streamed so far' });
  });

  it('tears down all subscriptions when the chat closes (clearCurrentlyViewedAgent)', () => {
    const agentId = 'agent-sub-close';
    seedSession(agentId);
    const sub = openChat(agentId);

    appStore.dispatch(clearCurrentlyViewedAgent());
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('renders the interrupted partial row with Stopped metadata after the §7.2 terminal reconcile', () => {
    // Interrupt-send during streaming (cloudlands-fe#132): the daemon
    // persists the partial row before agent:stream:end, so the terminal
    // reconcile's transcript CONTAINS the streamed message tagged with
    // `metadata.interrupted` / `metadata.stopReason` (§7.2). The store must
    // keep the partial blocks and the Stopped indicator must render once the
    // stream is over. On an interrupt-priority send the interrupted row
    // precedes the new user message.
    const agentId = 'agent-sub-interrupt';
    seedSession(agentId);
    const sub = openChat(agentId);

    // Live partial mid-turn.
    const partial = makeMessage('0190a200-asst', 'Partial ');
    sub.handler(transcript([partial], true));
    expect(selectAgentSession.select(appStore.state, agentId)?.isStreaming).toBe(true);

    // Terminal reconcile after the interrupt-priority send: the persisted
    // interrupted row (same id, Stopped metadata) followed by the new user
    // message; isStreaming falls.
    const interrupted = makeMessage('0190a200-asst', 'Partial ', {
      metadata: { interrupted: true, stopReason: 'interrupted' },
    });
    const nextUser = makeMessage('0190a1c0-user2', 'Do this instead', {
      role: 'user',
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    sub.handler(transcript([interrupted, nextUser]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    expect(messages.map((m) => m.id)).toEqual(['0190a200-asst', '0190a1c0-user2']);
    // The partial output survives — not wiped, not replaced by a placeholder.
    expect(messages[0].contentBlocks?.[0]).toMatchObject({ text: 'Partial ' });
    expect(messages[0].metadata).toMatchObject({
      interrupted: true,
      stopReason: 'interrupted',
    });
    const session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(false);
    // The Stopped indicator renders from the persisted metadata now that the
    // stream is over (and stays hidden while one is still in flight).
    expect(shouldShowStoppedIndicator({ message: messages[0], isStreaming: false })).toBe(true);
    expect(shouldShowStoppedIndicator({ message: messages[0], isStreaming: true })).toBe(false);
  });

  it('does not open a subscription while a soft-hidden deletion is pending, and tears down on removeSession', () => {
    const agentId = 'agent-sub-deleted';
    seedSession(agentId);
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession(agentId),
      timer: null,
    });
    try {
      appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(0);
    } finally {
      removePendingAgentDeletion(agentId);
    }

    // Once the pending entry is gone, opening works; the soft-hide dispatch
    // (removeSession) then closes it.
    const sub = openChat(agentId);
    appStore.dispatch(removeSession(agentId));
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-applies the last reconciled transcript when a slower hydrate settles without the finalized row (monorepo#1161)', () => {
    // Hydrate/finalize race: the standing subscription's reconcile delivered
    // the finalized assistant row, then a slower chat-read hydrate (whose
    // paged fetch predates the finalize) lands a full-list upsert WITHOUT
    // that row — clobbering it. The persisted row is not stream-owned
    // (isStreaming false), so the read-side guard cannot preserve it; the
    // subscription must re-assert its canonical transcript on
    // transcriptHydrationSettled.
    const agentId = 'agent-sub-hydrate-race';
    seedSession(agentId);
    const sub = openChat(agentId);

    const user = makeMessage('0190a1b2-user', 'Run the tests', {
      role: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const finalized = makeMessage('0190a200-asst', 'All tests pass.');
    sub.handler(transcript([user, finalized]));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      '0190a1b2-user',
      '0190a200-asst',
    ]);

    // The stale hydrate lands: full-list upsert covering only the user row.
    appStore.dispatch(bulkUpsertSessions([makeSession(agentId, { messages: [user] })]));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      '0190a1b2-user',
    ]);

    // Hydration settles: the subscription re-asserts its last transcript.
    appStore.dispatch(transcriptHydrationSettled(agentId));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      '0190a1b2-user',
      '0190a200-asst',
    ]);
  });

  it('does not re-fire the streaming edge when re-applying on hydrate settle', () => {
    const agentId = 'agent-sub-settle-no-edge';
    seedSession(agentId);
    const sub = openChat(agentId);

    // Rising then falling edge: the turn streamed and finalized.
    sub.handler(transcript([makeMessage('m-turn', 'working')], true));
    const finalized = makeMessage('m-turn', 'done');
    sub.handler(transcript([finalized], false));
    expect(selectAgentSession.select(appStore.state, agentId)?.isStreaming).toBe(false);

    // A fresh optimistic turn starts (chatSendStarted equivalent) before the
    // stale hydrate settles.
    appStore.dispatch(updateSession(agentId, { isStreaming: true, isProcessing: true }));
    appStore.dispatch(bulkUpsertSessions([makeSession(agentId, { messages: [] })]));

    appStore.dispatch(transcriptHydrationSettled(agentId));

    // The re-apply restores the finalized row without re-dispatching the
    // already-consumed falling edge — the fresh optimistic flags survive.
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      'm-turn',
    ]);
    const session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);
  });

  it('treats transcriptHydrationSettled as a no-op with no live subscription or before the first emit', () => {
    // No subscription at all.
    const agentA = 'agent-sub-settle-nosub';
    const seeded = makeMessage('seeded-a', 'hydrated history');
    seedSession(agentA, { messages: [seeded] });
    appStore.dispatch(transcriptHydrationSettled(agentA));
    expect(selectAgentMessages.select(appStore.state, agentA).map((m) => m.id)).toEqual([
      'seeded-a',
    ]);

    // Subscription open but nothing emitted yet.
    const agentB = 'agent-sub-settle-preemit';
    seedSession(agentB, { messages: [makeMessage('seeded-b', 'hydrated history')] });
    const sub = openChat(agentB);
    appStore.dispatch(transcriptHydrationSettled(agentB));
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(selectAgentMessages.select(appStore.state, agentB).map((m) => m.id)).toEqual([
      'seeded-b',
    ]);
  });

  it("keeps the viewed agent's subscription open when a background panel's trailing clearCurrentlyViewedAgent lands after the handoff (missing-live-turn regression)", async () => {
    // Two agent tabs mounted in ONE panel (the panel system keeps inactive
    // tabs mounted for PANEL_TAB_CACHE_TTL_MS before unmounting). This is the
    // exact action sequence the two ChatPanels emit:
    //
    //   1. Switching BACK to tab A (earlier in tree order), A's unread
    //      effect runs first: markAgentAsViewed(A) closes B's subscription
    //      and reopens A's.
    //   2. THEN B's panel emits clearCurrentlyViewedAgent — from its
    //      deactivation effect, and again ~30s later from onDestroy when the
    //      tab cache evicts the hidden tab.
    //
    // Neither trailing clear means "no chat is viewed": A is still the
    // visible, viewed chat. Each panel scopes its clear to its own agent, so
    // B's trailing clear is a reducer no-op (A is viewed) and the saga must
    // NOT close A's subscription — otherwise A's
    // subscription (the sole transcript writer) dies and A's next live turn
    // renders NOTHING (no thinking, no stop button) until a remount
    // re-initializes the chat.
    const agentA = 'agent-sub-handoff-a';
    const agentB = 'agent-sub-handoff-b';
    seedSession(agentA);
    seedSession(agentB);

    // A's ChatPanel mounts and is viewed.
    openChat(agentA);
    appStore.dispatch(markAgentAsViewed(agentA));

    // Switch A → B: A's deactivating panel clears (scoped to its own agent),
    // B's activating panel views + mounts.
    appStore.dispatch(clearCurrentlyViewedAgent(agentA));
    appStore.dispatch(markAgentAsViewed(agentB));
    openChat(agentB);

    // Switch back B → A: A's panel activates first and reopens A's
    // subscription…
    appStore.dispatch(markAgentAsViewed(agentA));
    await vi.waitFor(() => {
      expect(fakeSubscriptions.filter((s) => s.agentId === agentA)).toHaveLength(2);
    });
    const reopened = [...fakeSubscriptions].reverse().find((s) => s.agentId === agentA);
    expect(reopened).toBeDefined();

    // …then B's still-mounted panel emits the trailing clear (deactivation
    // effect now, onDestroy again on cache eviction — same dispatch).
    appStore.dispatch(clearCurrentlyViewedAgent(agentB));

    // REGRESSION: the trailing clear must not close the viewed agent's
    // standing subscription.
    expect(reopened!.unsubscribe).not.toHaveBeenCalled();

    // A live emit for the viewed agent must still apply to the store.
    reopened!.handler(transcript([makeMessage('live-turn-msg', 'thinking…')], true));
    expect(selectAgentMessages.select(appStore.state, agentA).map((m) => m.id)).toContain(
      'live-turn-msg',
    );
  });

  // Reopen snapshot stall (monorepo#2864) — same-agent hole in the
  // monorepo#1215 cross-agent guard, closed by sparing agents whose
  // transcript hydration sits in `loading` from the applied clear's
  // close-all sweep.
  it("keeps the standing subscription when a same-agent remount's trailing clearCurrentlyViewedAgent lands after the new instance re-initialized (reopen snapshot stall, monorepo#2864)", async () => {
    // Same-agent ChatPanel remount (tab close + immediate reopen of the
    // same conversation, or a column-windowing remount) where the NEW
    // instance mounts BEFORE the old instance's onDestroy runs:
    //
    //   1. New instance onMount → initializeChatRequested: deduped against
    //      the still-open standing subscription (slot.desiredToken set).
    //      Its viewed effect's markAgentAsViewed no-ops in the reducer
    //      (the agent is already viewed). The chat-read saga starts
    //      hydration and waits for a seq-0 snapshot application.
    //   2. THEN the old instance's onDestroy emits its scoped
    //      clearCurrentlyViewedAgent — SAME agent, so the monorepo#1215
    //      cross-agent guard cannot help: the reducer clears the viewed
    //      agent to null, and the saga's viewed===null branch closes
    //      EVERY non-chief subscription — including the one the new
    //      instance was just deduped against. The phase-null teardown
    //      drops the snapshot meta.
    //
    // With the subscription closed and both opens already consumed, no
    // seq-0 snapshot is coming: hydration strands for the full
    // SNAPSHOT_WAIT_MS window (~8s) until the
    // chatTranscriptSnapshotRerequested escalation force-cycles a fresh
    // registration (monorepo#2692) — the user-visible reopen stall.
    const agentId = 'agent-sub-reopen-remount';
    seedSession(agentId);
    // The remounted panel's agent tab is (still) open in the layout.
    appStore.dispatch(openTab(WS, { type: 'agent', title: 'Agent Sub', closable: true, agentId }));
    // Old instance's mount-time interest lease (monorepo#3295).
    acquireChatInterestLease(agentId, 'panel-old');
    const sub = openChat(agentId);
    appStore.dispatch(markAgentAsViewed(agentId));
    sub.handler({ ...transcript([makeMessage('m-reopen', 'hello')]), fromSnapshot: true });
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)?.seq).toBe(1);

    // New instance mounts: its lease is acquired synchronously at the top
    // of onMount, then both dispatches dedupe against the standing
    // subscription; the read saga enters loading (its hydration holds a
    // lease of its own).
    acquireChatInterestLease(agentId, 'panel-new');
    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
    appStore.dispatch(markAgentAsViewed(agentId));
    acquireChatInterestLease(agentId, 'chat-read:remount');
    appStore.dispatch(transcriptHydrationStarted(agentId));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(1);

    // Old instance's onDestroy: releases its own lease FIRST, then its
    // trailing scoped clear lands — the remounted instance (and the
    // in-flight hydration) still hold theirs.
    releaseChatInterestLease(agentId, 'panel-old');
    appStore.dispatch(clearCurrentlyViewedAgent(agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The trailing clear must not tear down the subscription the
    // remounted panel depends on: closing it drops the snapshot meta and
    // strands hydration with no seq-0 emit coming (nothing reopens — the
    // remount's own open was consumed by the dedup).
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toBeDefined();

    // Hydration settles and releases its lease; the remounted panel's
    // lease remains — no last-lease release, so the deferred close never
    // runs (the spare was for THIS live panel, not a leak).
    releaseChatInterestLease(agentId, 'chat-read:remount');
    appStore.dispatch(transcriptHydrationSettled(agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });

  it('runs the deferred close once hydration settles when the panel was genuinely closed mid-load (no leaked subscription, monorepo#2864)', async () => {
    // Genuine final panel close while hydration is still in flight: the
    // applied clear's sweep spares the agent (its hydration still holds a
    // lease — indistinguishable from a same-agent remount at that
    // instant), but once that last lease releases with no re-view, the
    // deferred close must run — otherwise the standing subscription leaks
    // until an unrelated view switch or session teardown (PR #1462
    // review).
    const agentId = 'agent-sub-close-mid-load';
    seedSession(agentId);
    const sub = openChat(agentId);
    appStore.dispatch(markAgentAsViewed(agentId));
    acquireChatInterestLease(agentId, 'chat-read:mid-load');
    appStore.dispatch(transcriptHydrationStarted(agentId));

    // Panel closes mid-load: its own lease is gone (released in
    // onDestroy), the trailing clear applies, and the sweep spares the
    // still-leased hydration (deferred).
    appStore.dispatch(clearCurrentlyViewedAgent(agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    // Hydration settles and releases the LAST lease (the read saga's
    // finally): agent not re-viewed — the deferred close tears the
    // subscription down now.
    appStore.dispatch(transcriptHydrationSettled(agentId));
    releaseChatInterestLease(agentId, 'chat-read:mid-load');
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  it('runs the deferred close once hydration fails when the panel was genuinely closed mid-load (monorepo#2864)', async () => {
    // Same leak, failure edge: a hydration that FAILS after the spare
    // releases its lease in the read saga's finally too — the deferred
    // close still runs; an in-flight hydration never wedges the spare.
    const agentId = 'agent-sub-close-mid-load-failed';
    seedSession(agentId);
    const sub = openChat(agentId);
    appStore.dispatch(markAgentAsViewed(agentId));
    acquireChatInterestLease(agentId, 'chat-read:mid-load-fail');
    appStore.dispatch(transcriptHydrationStarted(agentId));

    appStore.dispatch(clearCurrentlyViewedAgent(agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    appStore.dispatch(transcriptHydrationFailed(agentId));
    releaseChatInterestLease(agentId, 'chat-read:mid-load-fail');
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  // Cold-open snapshot miss under rapid workspace switching (monorepo#2917) —
  // the viewed-agent swap (handleViewed) used to sweep ALL other same-realm
  // slots with no spare: when the final workspace double-mounts two
  // ChatPanels, the second panel's markAgentAsViewed closed the first
  // panel's still-acquiring cold-open slot (desiredToken cleared +
  // cancelPending), so its chat.subscribe — which issued promptly — resolved
  // straight into an unsubscribe and its seq-0 snapshot was token-dropped.
  // Both of that panel's opens were already consumed (init + its own viewed),
  // so no snapshot was coming: the chat-read saga stranded a full
  // SNAPSHOT_WAIT_MS window and logged the wait-window warning before the
  // re-request escalation force-cycled a fresh registration. Fixed by the
  // spare-then-revisit contract, now lease-based (monorepo#3295): the
  // mounted sibling panel's interest lease spares it from the sweep.
  it('spares a sibling cold open mid-acquisition from the viewed-agent swap during a double ChatPanel mount (monorepo#2917)', async () => {
    const hopA = 'agent-2917-hop-a';
    const hopB = 'agent-2917-hop-b';
    const finalC1 = 'agent-2917-final-c1';
    const finalC2 = 'agent-2917-final-c2';
    for (const id of [hopA, hopB, finalC1, finalC2]) seedSession(id);

    // Churn hops: two workspaces opened and closed within ~2s each. The
    // hops are modeled as viewed/clear cycles inside the single harness
    // workspace WS rather than actual workspace switches — mechanically
    // equivalent because handleViewed's sweep predicate is realm-scoped
    // (chief vs. workspace), not per-workspace. Their subscribes issue
    // promptly (no queueing behind prior closes) and the fake unsubscribe
    // settles synchronously, so the hops leave no barrier behind by the
    // time the final workspace mounts.
    openChat(hopA);
    appStore.dispatch(markAgentAsViewed(hopA));
    appStore.dispatch(clearCurrentlyViewedAgent(hopA));
    openChat(hopB);
    appStore.dispatch(markAgentAsViewed(hopB));
    appStore.dispatch(clearCurrentlyViewedAgent(hopB));
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === hopA)).toHaveLength(1);
    expect(chatApi.subscribe.mock.calls.filter(([id]) => id === hopB)).toHaveLength(1);

    // Final workspace double-mounts two ChatPanels (both agent tabs open in
    // the layout). Both cold opens issue chat.subscribe immediately; over
    // WSS the acquisition resolves asynchronously.
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'C1', closable: true, agentId: finalC1 }),
    );
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'C2', closable: true, agentId: finalC2 }),
    );
    // Each mounting panel acquires its interest lease synchronously at
    // the top of onMount, before its init/viewed dispatches.
    acquireChatInterestLease(finalC1, 'panel-c1');
    const c1 = delayNextSubscription(finalC1);
    appStore.dispatch(transcriptHydrationStarted(finalC1));
    appStore.dispatch(markAgentAsViewed(finalC1));
    acquireChatInterestLease(finalC2, 'panel-c2');
    const c2 = delayNextSubscription(finalC2);
    appStore.dispatch(transcriptHydrationStarted(finalC2));
    // The second panel's viewed effect — without the lease spare this
    // closes C1's still-acquiring slot.
    appStore.dispatch(markAgentAsViewed(finalC2));

    // Both WSS acquisitions resolve after the sweep ran.
    c1.acquisition.resolve(c1.subscription.unsubscribe);
    c2.acquisition.resolve(c2.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The daemon emits both seq-0 snapshots.
    c2.subscription.handler({
      ...transcript([makeMessage('m-2917-c2', 'c2 snapshot')]),
      fromSnapshot: true,
    });
    c1.subscription.handler({
      ...transcript([makeMessage('m-2917-c1', 'c1 snapshot')]),
      fromSnapshot: true,
    });

    // The last-viewed panel hydrates fine…
    expect(selectTranscriptSnapshotMeta.select(appStore.state, finalC2)).toBeDefined();

    // …and the sibling cold open must survive the swap (its mounted
    // panel holds a lease): the snapshot applies instead of stranding
    // the read saga for a full wait window.
    expect(c1.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, finalC1)).toBeDefined();
    expect(selectAgentMessages.select(appStore.state, finalC1).map((m) => m.id)).toContain(
      'm-2917-c1',
    );

    // The spare defers the close, it never cancels it: the sibling's
    // hydration settles with its panel still mounted (lease held) — the
    // subscription stays (the spare was for THIS live panel).
    appStore.dispatch(transcriptHydrationSettled(finalC1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c1.subscription.unsubscribe).not.toHaveBeenCalled();
  });

  // Remaining hole behind the monorepo#2917 fix (v2.75.1 recurrence,
  // monorepo#3073): the swap sweep's spare keys on
  // selectTranscriptHydration === 'loading', but the chat-read saga never
  // flips that flag synchronously with initializeChatRequested — its worker
  // first awaits the hydrationTails chain (hydrateAfterPrevious's
  // `yield* call(() => previous)`), deferring transcriptHydrationStarted by
  // at least one microtask. When a workspace layout restore mounts two
  // ChatPanels inside ONE synchronous flush (the v2.75.1 trace: both
  // init/viewed dispatch pairs inside a single heavy task, no microtask
  // checkpoint between them), the second panel's markAgentAsViewed sweep
  // runs while the first agent's hydration is still unset (`undefined` —
  // never started) — the loading spare alone cannot match, and without the
  // mid-acquisition spare the first panel's still-acquiring cold-open slot
  // would be closed (desiredToken cleared + cancelPending), its seq-0
  // snapshot token-dropped, and the chat-read saga stranded for a full
  // SNAPSHOT_WAIT_MS window (the "No transcript snapshot recorded within
  // wait window" warn). The sweep therefore also spares a hosted slot whose
  // open is still acquiring (nothing installed yet) before its hydration
  // flag exists. The monorepo#2917 test above cannot see this: it hand-dispatches
  // transcriptHydrationStarted BEFORE the sibling's viewed dispatch — an
  // ordering the real read saga cannot produce for a same-task sweep.
  it('spares a sibling cold open from a same-task viewed-agent swap that runs before the read saga flips its hydration to loading (monorepo#3073)', async () => {
    const first = 'agent-3073-same-task-first';
    const second = 'agent-3073-same-task-second';
    seedSession(first);
    seedSession(second);
    // Both agent tabs are in the restored layout before the panels mount.
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'First', closable: true, agentId: first }),
    );
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Second', closable: true, agentId: second }),
    );

    // One synchronous task, no microtask checkpoints: both panels'
    // mount-time leases + init/viewed dispatches land back-to-back,
    // exactly as a single effect flush delivers them. Over WSS both
    // acquisitions resolve later. The lease is the only sweep-time signal
    // that exists this early — the read saga's loading flag lands at
    // least one microtask later.
    acquireChatInterestLease(first, 'panel-3073-first');
    const c1 = delayNextSubscription(first);
    appStore.dispatch(markAgentAsViewed(first));
    acquireChatInterestLease(second, 'panel-3073-second');
    const c2 = delayNextSubscription(second);
    appStore.dispatch(markAgentAsViewed(second));

    // The read saga's hydration flags land only after the current task —
    // after the second panel's swap sweep already ran.
    appStore.dispatch(transcriptHydrationStarted(first));
    appStore.dispatch(transcriptHydrationStarted(second));

    c1.acquisition.resolve(c1.subscription.unsubscribe);
    c2.acquisition.resolve(c2.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The daemon emits both seq-0 snapshots.
    c2.subscription.handler({
      ...transcript([makeMessage('m-3073-second', 'second snapshot')]),
      fromSnapshot: true,
    });
    c1.subscription.handler({
      ...transcript([makeMessage('m-3073-first', 'first snapshot')]),
      fromSnapshot: true,
    });

    // The viewed panel hydrates fine…
    expect(selectTranscriptSnapshotMeta.select(appStore.state, second)).toBeDefined();

    // …and the sibling cold open must survive the same-task sweep (a
    // mounted panel is actively waiting on its snapshot): the snapshot
    // applies instead of stranding the read saga for a full wait window.
    expect(c1.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, first)).toBeDefined();
    expect(selectAgentMessages.select(appStore.state, first).map((m) => m.id)).toContain(
      'm-3073-first',
    );
  });

  it('runs the deferred close once hydration settles when a swap-spared still-acquiring sibling panel closed mid-acquisition (no leaked subscription, monorepo#3073)', async () => {
    // Leak guard for the mid-acquisition spare: a sibling spared before its
    // hydration flag ever existed enters the same spare-then-revisit
    // contract as the loading spare — its preserved slot's read saga is in
    // flight, so hydration eventually starts and settles/fails. If the
    // panel genuinely closed in the meantime, the settle-time revisit must
    // tear the subscription down instead of leaking it.
    const sibling = 'agent-3073-acquiring-leak-sibling';
    const viewed = 'agent-3073-acquiring-leak-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    acquireChatInterestLease(sibling, 'panel-3073-leak');
    const c = delayNextSubscription(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));

    // Same-task sweep while the sibling is still acquiring (hydration
    // unset, desiredToken held, nothing installed): its mount-time lease
    // spares it.
    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    c.acquisition.resolve(c.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.subscription.unsubscribe).not.toHaveBeenCalled();

    // The sibling's panel closes mid-load (destroy releases its lease —
    // the LAST one) with no re-view: the deferred close runs at the
    // release, no settle needed.
    appStore.dispatch(clearPanelLayout(WS));
    releaseChatInterestLease(sibling, 'panel-3073-leak');
    await vi.waitFor(() => expect(c.subscription.unsubscribe).toHaveBeenCalledOnce());
  });

  // Warm-reopen hole behind the monorepo#3073 fix (v2.79.0 recurrence,
  // monorepo#3185): both acquiring-slot spares to date keyed on the
  // hydration flag's VALUE — the swap sweep spares `loading` (monorepo#2917)
  // and, for a cold open, `undefined` (never hydrated, monorepo#3073). But
  // chat state is per-agent and survives workspace switches: on a REVISITED
  // workspace the remounting panels' agents still carry transcriptHydration
  // 'settled' from the previous visit, while their subscriptions were closed
  // at switch-away (snapshot meta dropped by the phase-null teardown). A
  // same-flush double mount reopens both agents (the read saga's loading
  // flag lands at least one microtask later); the second panel's
  // markAgentAsViewed sweep then reads the FIRST agent's STALE 'settled'
  // flag — neither spare matches — and closes its still-acquiring reopen:
  // desiredToken cleared + cancelPending, its chat.subscribe resolves
  // straight into an unsubscribe, the seq-0 snapshot is token-dropped, and
  // with both of that panel's opens already consumed (init + viewed) the
  // chat-read saga strands a full SNAPSHOT_WAIT_MS window (the "No
  // transcript snapshot recorded within wait window" warn in the v2.79.0
  // trace). The hydration flag's value cannot be trusted at sweep time —
  // only the slot's acquisition state can: the sweep must spare ANY hosted
  // slot whose open is still acquiring (nothing installed yet).
  it('spares a warm still-acquiring reopen from the viewed-agent swap on a revisited-workspace double mount (monorepo#3185)', async () => {
    const first = 'agent-3185-warm-first';
    const second = 'agent-3185-warm-second';
    const prev = 'agent-3185-warm-prev';
    seedSession(first);
    seedSession(second);
    seedSession(prev);
    // Both agent tabs persist in the revisited workspace's layout.
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'First', closable: true, agentId: first }),
    );
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Second', closable: true, agentId: second }),
    );

    // Previous visit: the first agent hydrated and settled…
    const priorSub = openChat(first);
    appStore.dispatch(markAgentAsViewed(first));
    priorSub.handler({ ...transcript([]), fromSnapshot: true });
    appStore.dispatch(transcriptHydrationStarted(first));
    appStore.dispatch(transcriptHydrationSettled(first));

    // …then the user switched workspaces: viewing an agent there sweeps
    // the first agent's subscription (settled, same realm) — its snapshot
    // meta drops with the phase-null teardown, but transcriptHydration
    // stays 'settled' in the per-agent chat state.
    openChat(prev);
    appStore.dispatch(markAgentAsViewed(prev));
    await vi.waitFor(() => expect(priorSub.unsubscribe).toHaveBeenCalledOnce());

    // Switch-back double mount, one synchronous flush: both panels'
    // mount-time leases + init/viewed dispatches land back-to-back before
    // the read saga can flip either hydration flag. Over WSS both reopens
    // acquire asynchronously.
    acquireChatInterestLease(first, 'panel-3185-first');
    const c1 = delayNextSubscription(first);
    appStore.dispatch(markAgentAsViewed(first));
    acquireChatInterestLease(second, 'panel-3185-second');
    const c2 = delayNextSubscription(second);
    // The second panel's viewed sweep — without the lease spare it closes
    // the first agent's still-acquiring warm reopen (the stale 'settled'
    // flag defeated both heuristic spares).
    appStore.dispatch(markAgentAsViewed(second));

    // The read saga's hydration flags land only after the current task.
    appStore.dispatch(transcriptHydrationStarted(first));
    appStore.dispatch(transcriptHydrationStarted(second));

    c1.acquisition.resolve(c1.subscription.unsubscribe);
    c2.acquisition.resolve(c2.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The daemon emits both seq-0 snapshots.
    c2.subscription.handler({
      ...transcript([makeMessage('m-3185-second', 'second snapshot')]),
      fromSnapshot: true,
    });
    c1.subscription.handler({
      ...transcript([makeMessage('m-3185-first', 'first snapshot')]),
      fromSnapshot: true,
    });

    // The last-viewed panel hydrates fine…
    expect(selectTranscriptSnapshotMeta.select(appStore.state, second)).toBeDefined();

    // …and the first panel's warm reopen must survive the sweep: its
    // snapshot applies instead of stranding the read saga a full window.
    expect(c1.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, first)).toBeDefined();
    expect(selectAgentMessages.select(appStore.state, first).map((m) => m.id)).toContain(
      'm-3185-first',
    );

    // The spare defers the close, it never cancels it: hydration settles
    // with the panel tab still open — the revisit keeps the subscription.
    appStore.dispatch(transcriptHydrationSettled(first));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c1.subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("spares a warm still-acquiring reopen from an applied clear's close-all sweep when the departing panel's destroy lands after the remount's init (monorepo#3185)", async () => {
    // Same stale-'settled' hole in the OTHER sweep (the applied clear's,
    // monorepo#2864 branch): the previous workspace's departing ChatPanel
    // destroys AFTER the revisited workspace's panel already dispatched
    // its init (Svelte defers teardown to the microtask flush). Its scoped
    // clear applies (that agent is still the viewed one), and the
    // close-all sweep spares only hydration === 'loading' — the remounting
    // agent's stale 'settled' flag lets the sweep close its
    // still-acquiring warm reopen, token-dropping the seq-0 snapshot.
    const agentId = 'agent-3185-clear-warm';
    const prev = 'agent-3185-clear-prev';
    seedSession(agentId);
    seedSession(prev);
    appStore.dispatch(openTab(WS, { type: 'agent', title: 'Warm', closable: true, agentId }));

    // Previous visit: hydrated + settled, then swept by viewing the
    // previous workspace's agent.
    const priorSub = openChat(agentId);
    appStore.dispatch(markAgentAsViewed(agentId));
    priorSub.handler({ ...transcript([]), fromSnapshot: true });
    appStore.dispatch(transcriptHydrationStarted(agentId));
    appStore.dispatch(transcriptHydrationSettled(agentId));
    openChat(prev);
    appStore.dispatch(markAgentAsViewed(prev));
    await vi.waitFor(() => expect(priorSub.unsubscribe).toHaveBeenCalledOnce());

    // Switch back: the remounting panel acquires its lease at mount and
    // its init reopens (acquiring over WSS); the departing panel's
    // destroy then dispatches its scoped clear, which APPLIES — the
    // close-all sweep runs while the reopen is still acquiring under a
    // stale 'settled' hydration flag, spared by the lease.
    acquireChatInterestLease(agentId, 'panel-3185-clear');
    const c = delayNextSubscription(agentId);
    appStore.dispatch(clearCurrentlyViewedAgent(prev));

    c.acquisition.resolve(c.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    c.subscription.handler({
      ...transcript([makeMessage('m-3185-clear', 'warm snapshot')]),
      fromSnapshot: true,
    });

    // The hosted warm reopen survives; its snapshot applies.
    expect(c.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(selectTranscriptSnapshotMeta.select(appStore.state, agentId)).toBeDefined();

    // Spare-then-revisit: the in-flight init flips hydration and settles
    // with the tab still open — the subscription stays for the live panel.
    appStore.dispatch(transcriptHydrationStarted(agentId));
    appStore.dispatch(transcriptHydrationSettled(agentId));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('runs the deferred close once hydration settles when a warm swap-spared reopen panel closed mid-load (no leaked subscription, monorepo#3185)', async () => {
    // Leak guard for the warm-reopen spare: same spare-then-revisit
    // contract as the loading/cold-open spares — if the panel genuinely
    // closes while the spared reopen's hydration is in flight, the
    // settle-time revisit tears the subscription down.
    const warm = 'agent-3185-warm-leak';
    const viewed = 'agent-3185-warm-leak-viewed';
    const prev = 'agent-3185-warm-leak-prev';
    seedSession(warm);
    seedSession(viewed);
    seedSession(prev);
    appStore.dispatch(openTab(WS, { type: 'agent', title: 'Warm', closable: true, agentId: warm }));

    // Previous visit: settled, then swept.
    const priorSub = openChat(warm);
    appStore.dispatch(markAgentAsViewed(warm));
    priorSub.handler({ ...transcript([]), fromSnapshot: true });
    appStore.dispatch(transcriptHydrationStarted(warm));
    appStore.dispatch(transcriptHydrationSettled(warm));
    openChat(prev);
    appStore.dispatch(markAgentAsViewed(prev));
    await vi.waitFor(() => expect(priorSub.unsubscribe).toHaveBeenCalledOnce());

    // Warm reopen still acquiring when another agent's viewed sweep runs:
    // the spare holds (mount-time lease).
    acquireChatInterestLease(warm, 'panel-3185-warm-leak');
    const c = delayNextSubscription(warm);
    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    c.acquisition.resolve(c.subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.subscription.unsubscribe).not.toHaveBeenCalled();

    // The panel closes mid-load: its destroy releases the LAST lease with
    // no re-view — the deferred close runs.
    appStore.dispatch(clearPanelLayout(WS));
    releaseChatInterestLease(warm, 'panel-3185-warm-leak');
    await vi.waitFor(() => expect(c.subscription.unsubscribe).toHaveBeenCalledOnce());
  });

  // Fifth recurrence in the stranded-window family (monorepo#3295, local UDS
  // daemon): rapid workspace switching lands on a REVISITED double-mount
  // workspace right after the previous workspace's panel was torn down
  // mid-hydration. On a local daemon the first-mounted (viewed) agent's
  // chat.subscribe acquisition resolves almost immediately, so by the time
  // the sibling panel's markAgentAsViewed sweep runs (~18ms later) the
  // reopen is already INSTALLED — no longer "acquiring" — while its
  // per-agent chat state still reads the PREVIOUS visit's 'settled' (chat
  // state survives workspace switches, and the read saga flips 'loading'
  // only after the current task). Neither historical heuristic spare could
  // match (monorepo#2917's loading spare, monorepo#3073/#3185's acquiring
  // spare both miss an installed-not-yet-emitted registration under a stale
  // settled flag), so the sweep closed the registration the viewed panel
  // was waiting on BEFORE its seq-0 snapshot arrived — stranding that
  // hydration a full SNAPSHOT_WAIT_MS window. FIXED by lease-based sparing:
  // the first-mounted panel's interest lease (acquired synchronously at
  // mount, before any dispatch) spares its installed reopen from the
  // sibling's sweep regardless of acquisition state or stale flags.
  it("double-mount sweep spares the first-mounted viewed agent's leased installed reopen; its seq-0 snapshot applies (monorepo#3295)", async () => {
    vi.useFakeTimers();
    try {
      const prevWs = 'ws-chat-sub-3295-prev';
      const prior = 'agent-3295-prior';
      const first = 'agent-3295-first';
      const second = 'agent-3295-second';
      seedSession(prior, { workspaceId: prevWs });
      seedSession(first);
      seedSession(second);
      // Both target-workspace agent tabs sit in the restored layout; the
      // prior workspace's tab persists in ITS layout across the switch.
      appStore.dispatch(
        openTab(WS, { type: 'agent', title: 'First', closable: true, agentId: first }),
      );
      appStore.dispatch(
        openTab(WS, { type: 'agent', title: 'Second', closable: true, agentId: second }),
      );
      appStore.dispatch(
        openTab(prevWs, { type: 'agent', title: 'Prior', closable: true, agentId: prior }),
      );

      // PREVIOUS VISIT of the target workspace: the first agent hydrated
      // and settled — its per-agent chat state keeps 'settled' across the
      // switches below. Its panel is then unmounted by the switch (lease
      // released, none held here).
      const firstPrior = openChat(first);
      appStore.dispatch(markAgentAsViewed(first));
      firstPrior.handler({ ...transcript([]), fromSnapshot: true });
      appStore.dispatch(transcriptHydrationStarted(first));
      appStore.dispatch(transcriptHydrationSettled(first));

      // Switch to the prior workspace: its panel mounts (lease first) and
      // starts hydrating (hydration lease); the viewed swap sweeps
      // first's settled, unleased subscription.
      acquireChatInterestLease(prior, 'panel-3295-prior');
      appStore.dispatch(initializeChatRequested(prior, { wsId: prevWs }));
      const priorSub = fakeSubscriptions.find((s) => s.agentId === prior);
      if (!priorSub) throw new Error('no chat.subscribe recorded for prior');
      appStore.dispatch(markAgentAsViewed(prior));
      acquireChatInterestLease(prior, 'chat-read:3295-prior');
      appStore.dispatch(transcriptHydrationStarted(prior));
      await vi.advanceTimersByTimeAsync(0);
      expect(firstPrior.unsubscribe).toHaveBeenCalledOnce();

      // ~460ms in, the prior workspace's panel is destroyed MID-HYDRATION
      // (before its snapshot or settle): it releases its own lease, then
      // its scoped clear applies (viewed → null) — the close-all sweep
      // spares the prior agent through its still-held hydration lease.
      // This teardown is in flight while the next workspace's opens land.
      await vi.advanceTimersByTimeAsync(460);
      releaseChatInterestLease(prior, 'panel-3295-prior');
      appStore.dispatch(clearCurrentlyViewedAgent(prior));
      expect(priorSub.unsubscribe).not.toHaveBeenCalled();

      // ~90ms later the target workspace double-mounts. Local UDS: the
      // first-mounted panel acquires its lease at the top of mount, then
      // its reopen acquisition resolves synchronously — the registration
      // INSTALLS immediately, its seq-0 snapshot still in flight.
      await vi.advanceTimersByTimeAsync(90);
      acquireChatInterestLease(first, 'panel-3295-first');
      appStore.dispatch(initializeChatRequested(first, { wsId: WS }));
      const firstSub = fakeSubscriptions.filter((s) => s.agentId === first).at(-1);
      if (!firstSub || firstSub === firstPrior) {
        throw new Error('no fresh chat.subscribe recorded for first');
      }
      appStore.dispatch(markAgentAsViewed(first));
      expect(firstSub.unsubscribe).not.toHaveBeenCalled();

      // ~18ms later the sibling panel mounts. The read saga has flipped
      // neither hydration flag yet (it defers past the current task) and
      // first's reopen is INSTALLED (not acquiring) under a stale
      // 'settled' flag — but its mount-time lease spares it from the
      // sibling's viewed sweep.
      await vi.advanceTimersByTimeAsync(18);
      acquireChatInterestLease(second, 'panel-3295-second');
      const secondSub = openChat(second);
      appStore.dispatch(markAgentAsViewed(second));
      appStore.dispatch(transcriptHydrationStarted(first));
      appStore.dispatch(transcriptHydrationStarted(second));
      expect(firstSub.unsubscribe).not.toHaveBeenCalled();

      // The daemon's seq-0 snapshots land; both registrations are alive.
      secondSub.handler({
        ...transcript([makeMessage('m-3295-second', 'second snapshot')]),
        fromSnapshot: true,
      });
      firstSub.handler({
        ...transcript([makeMessage('m-3295-first', 'first snapshot')]),
        fromSnapshot: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      // The second-mounted sibling hydrates fine…
      expect(selectTranscriptSnapshotMeta.select(appStore.state, second)).toBeDefined();

      // …and the FIRST-mounted (viewed) agent no longer strands: its
      // snapshot meta records, its rows apply, and the replayable
      // snapshot backs the read saga's fast path — the first bounded
      // wait window settles instead of sitting out SNAPSHOT_WAIT_MS.
      expect(firstSub.unsubscribe).not.toHaveBeenCalled();
      expect(selectTranscriptSnapshotMeta.select(appStore.state, first)).toBeDefined();
      expect(selectAgentMessages.select(appStore.state, first).map((m) => m.id)).toContain(
        'm-3295-first',
      );
      expect(hasReplayableChatSnapshot(first)).toBe(true);
    } finally {
      appStore.dispatch(clearPanelLayout('ws-chat-sub-3295-prev'));
      vi.useRealTimers();
    }
  });

  it("closes a sweep-spared agent at its LAST lease release when the final release comes from a cancelled hydration's finally (monorepo#3295)", async () => {
    // The deferred sweep-close must key on the lease registry, not on
    // settle/fail actions: a hydration cancelled mid-flight (workspace
    // unmount races the read saga's bounded wait) dispatches NEITHER
    // transcriptHydrationSettled nor Failed — its lease release in the
    // worker's finally is the only signal. If the deferred close did not
    // run at last-lease release, the subscription would leak until an
    // unrelated swap or session teardown.
    const spared = 'agent-3295-cancelled-hydration';
    const viewed = 'agent-3295-cancelled-viewed';
    seedSession(spared);
    seedSession(viewed);
    const sub = openChat(spared);
    appStore.dispatch(markAgentAsViewed(spared));
    // Panel + in-flight hydration both hold leases when the sweep runs.
    acquireChatInterestLease(spared, 'panel-3295-cancel');
    acquireChatInterestLease(spared, 'chat-read:3295-cancel');
    appStore.dispatch(transcriptHydrationStarted(spared));

    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    // The panel is destroyed (releases its lease; not the last one — the
    // hydration still runs). No close yet.
    releaseChatInterestLease(spared, 'panel-3295-cancel');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    // The hydration is CANCELLED: no settle/fail dispatch — only the
    // finally-block release of the LAST lease. The deferred close runs.
    releaseChatInterestLease(spared, 'chat-read:3295-cancel');
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  it('runs the deferred close once hydration settles when the swap-spared sibling panel closed mid-load (no leaked subscription, monorepo#2917)', async () => {
    // Leak guard for the swap-sweep spare, mirroring the applied-clear
    // sweep's (PR #1462): a sibling spared from the viewed-agent swap
    // whose consumers then all go away (panel destroyed, hydration
    // settled) must still be torn down at the last lease release —
    // otherwise the standing subscription leaks until an unrelated swap
    // or session teardown.
    const sibling = 'agent-2917-swap-leak-sibling';
    const viewed = 'agent-2917-swap-leak-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    const sub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    acquireChatInterestLease(sibling, 'chat-read:2917-leak');
    appStore.dispatch(transcriptHydrationStarted(sibling));

    // The swap spares the sibling: its in-flight hydration holds a lease.
    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    // The sibling's panel closes mid-load; hydration then settles and
    // releases the LAST lease with no re-view — the deferred close runs.
    appStore.dispatch(clearPanelLayout(WS));
    appStore.dispatch(transcriptHydrationSettled(sibling));
    releaseChatInterestLease(sibling, 'chat-read:2917-leak');
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  it('runs the deferred close once hydration fails when the swap-spared sibling panel closed mid-load (monorepo#2917)', async () => {
    // Same leak, failure edge: a hydration that FAILS after the swap spare
    // releases its lease in the read saga's finally too — the deferred
    // close still runs; an in-flight hydration never wedges it.
    const sibling = 'agent-2917-swap-leak-fail-sibling';
    const viewed = 'agent-2917-swap-leak-fail-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    const sub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    acquireChatInterestLease(sibling, 'chat-read:2917-leak-fail');
    appStore.dispatch(transcriptHydrationStarted(sibling));

    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    appStore.dispatch(clearPanelLayout(WS));
    appStore.dispatch(transcriptHydrationFailed(sibling));
    releaseChatInterestLease(sibling, 'chat-read:2917-leak-fail');
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  it('still sweeps an unleased same-realm sibling on the viewed-agent swap (spare requires a live consumer)', async () => {
    // Swap-invariant guard: the spare is scoped to siblings a live
    // consumer holds a lease on. An agent with no lease (no mounted
    // panel, no in-flight hydration) has nothing waiting on its snapshot,
    // so the swap still closes it — no over-spare. The stale `loading`
    // hydration flag alone (its lease already released) does not spare.
    const sibling = 'agent-2917-swap-unhosted-sibling';
    const viewed = 'agent-2917-swap-unhosted-viewed';
    seedSession(sibling);
    seedSession(viewed);
    const sub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    appStore.dispatch(transcriptHydrationStarted(sibling));

    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
  });

  it("closes a swap-spared sibling's surviving subscription when its tab closes after settle while another agent stays viewed (monorepo#2917)", async () => {
    // Post-settle leak: the swap spares the sibling (its panel holds a
    // lease), its hydration settles with the panel still mounted (lease
    // kept — the marker is retired only at last-lease release), and the
    // tab closes LATER while the new agent remains viewed. That close's
    // scoped clearCurrentlyViewedAgent is a reducer no-op (monorepo#1215
    // guard), so no sweep would reach the sibling — the scoped-clear
    // branch must close its own slot: the destroying panel released its
    // lease (the last one) before dispatching the clear.
    const sibling = 'agent-2917-post-settle-sibling';
    const viewed = 'agent-2917-post-settle-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    acquireChatInterestLease(sibling, 'panel-2917-post-settle');
    const siblingSub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    appStore.dispatch(transcriptHydrationStarted(sibling));

    // The swap spares the sibling; its hydration then settles with the
    // panel still mounted — the subscription survives for the live panel.
    const viewedSub = openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    appStore.dispatch(transcriptHydrationSettled(sibling));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(siblingSub.unsubscribe).not.toHaveBeenCalled();

    // The sibling's tab closes; its panel's destroy releases the lease
    // FIRST (onDestroy ordering), then dispatches the scoped clear.
    // Another agent is still viewed (reducer no-op) — the sibling's own
    // subscription must be torn down, the viewed one untouched.
    appStore.dispatch(clearPanelLayout(WS));
    releaseChatInterestLease(sibling, 'panel-2917-post-settle');
    appStore.dispatch(clearCurrentlyViewedAgent(sibling));
    await vi.waitFor(() => expect(siblingSub.unsubscribe).toHaveBeenCalledOnce());
    expect(viewedSub.unsubscribe).not.toHaveBeenCalled();
  });

  it("a trailing scoped clear keeps a swap-spared sibling's subscription while its tab is still open (deactivation, not close)", async () => {
    // Over-close guard for the scoped-clear branch: a panel DEACTIVATION
    // (tab switch) dispatches the same scoped clear as a destroy, but the
    // panel stays mounted (tab cache) and keeps its lease — the settled
    // sibling's subscription must survive, exactly like the monorepo#1215
    // trailing-clear contract.
    const sibling = 'agent-2917-deactivate-sibling';
    const viewed = 'agent-2917-deactivate-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    acquireChatInterestLease(sibling, 'panel-2917-deactivate');
    const siblingSub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    appStore.dispatch(transcriptHydrationStarted(sibling));

    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    appStore.dispatch(transcriptHydrationSettled(sibling));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(siblingSub.unsubscribe).not.toHaveBeenCalled();

    // Trailing scoped clear with the panel still mounted (lease held):
    // keep the subscription.
    appStore.dispatch(clearCurrentlyViewedAgent(sibling));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(siblingSub.unsubscribe).not.toHaveBeenCalled();
  });

  it('defers a scoped clear that lands while the swap-spared sibling is still loading with an open tab, closing once it settles unhosted (monorepo#2917)', async () => {
    // In-flight edge of the scoped-clear branch: the trailing clear
    // arrives BEFORE the sibling's hydration settles (its lease still
    // held) — the branch re-marks it for the spare-then-revisit contract
    // instead of closing a subscription a live consumer is waiting on.
    // When the hydration then releases the last lease, the deferred
    // close runs.
    const sibling = 'agent-2917-loading-clear-sibling';
    const viewed = 'agent-2917-loading-clear-viewed';
    seedSession(sibling);
    seedSession(viewed);
    appStore.dispatch(
      openTab(WS, { type: 'agent', title: 'Sibling', closable: true, agentId: sibling }),
    );
    const siblingSub = openChat(sibling);
    appStore.dispatch(markAgentAsViewed(sibling));
    acquireChatInterestLease(sibling, 'chat-read:2917-loading-clear');
    appStore.dispatch(transcriptHydrationStarted(sibling));

    openChat(viewed);
    appStore.dispatch(markAgentAsViewed(viewed));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(siblingSub.unsubscribe).not.toHaveBeenCalled();

    // Scoped clear while the hydration lease is held: defer — don't
    // cancel the in-flight hydration.
    appStore.dispatch(clearCurrentlyViewedAgent(sibling));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(siblingSub.unsubscribe).not.toHaveBeenCalled();

    // The tab closes, then hydration settles and releases the LAST lease
    // with no re-view — the deferred close runs.
    appStore.dispatch(clearPanelLayout(WS));
    appStore.dispatch(transcriptHydrationSettled(sibling));
    releaseChatInterestLease(sibling, 'chat-read:2917-loading-clear');
    await vi.waitFor(() => expect(siblingSub.unsubscribe).toHaveBeenCalledOnce());
  });

  it('flips the replayable-snapshot flag true on a snapshot emit and false on close (registry wiring, monorepo#2864)', async () => {
    // End-to-end pin of the registry wiring the chat-read saga's immediate
    // escalation consults: a dropped set-site would silently degrade the
    // fast path back to the full wait, a missed clear-site would re-request
    // against a torn-down registration.
    const agentId = 'agent-sub-replayable-wiring';
    seedSession(agentId);
    const sub = openChat(agentId);
    expect(hasReplayableChatSnapshot(agentId)).toBe(false);

    sub.handler({ ...transcript([makeMessage('m-rw', 'hello')]), fromSnapshot: true });
    expect(hasReplayableChatSnapshot(agentId)).toBe(true);

    // A non-snapshot delta emit clears it — the registration's latest
    // transcript can no longer answer a re-request without a fresh emit.
    sub.handler(transcript([makeMessage('m-rw', 'hello'), makeMessage('m-rw-2', 'more')]));
    expect(hasReplayableChatSnapshot(agentId)).toBe(false);

    sub.handler({ ...transcript([makeMessage('m-rw-3', 'snap')]), fromSnapshot: true });
    expect(hasReplayableChatSnapshot(agentId)).toBe(true);

    appStore.dispatch(removeSession(agentId));
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
    expect(hasReplayableChatSnapshot(agentId)).toBe(false);
  });

  it('flips the acquiring flag true on enqueue, false once standing installs, false again on close (registry wiring, monorepo#3295)', async () => {
    // End-to-end pin of the acquiring-marker wiring the chat-read saga's
    // dead-wait escalation consults: a missed set-site would strand a cold
    // open's plain wait, a missed clear-site (install/close/dispose) would
    // leave a stale acquisition that suppresses a genuine dead-wait escalation.
    const agentId = 'agent-sub-acquiring-wiring';
    seedSession(agentId);
    const { acquisition, subscription } = delayNextSubscription(agentId);
    // Open enqueued, acquisition still in flight: marked acquiring, not
    // standing yet.
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(true);
    expect(hasStandingChatSubscription(agentId)).toBe(false);

    // The registration installs: standing supersedes acquiring.
    acquisition.resolve(subscription.unsubscribe);
    await vi.waitFor(() => expect(hasStandingChatSubscription(agentId)).toBe(true));
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(false);

    // Teardown clears standing; nothing is acquiring afterwards.
    appStore.dispatch(removeSession(agentId));
    await vi.waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalledOnce());
    expect(hasStandingChatSubscription(agentId)).toBe(false);
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(false);
  });

  it('clears the acquiring flag when an in-flight open is cancelled before it installs (monorepo#3295)', async () => {
    // A close landing while the open is still acquiring must drop the
    // acquiring marker — otherwise a later hydration would read a stale
    // acquisition for a registration that never installed.
    const agentId = 'agent-sub-acquiring-cancel';
    seedSession(agentId);
    const { acquisition, subscription } = delayNextSubscription(agentId);
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(true);

    appStore.dispatch(removeSession(agentId));
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(false);

    // The acquisition resolving late must not resurrect the marker or a
    // standing registration (the open was cancelled).
    acquisition.resolve(subscription.unsubscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasChatSubscriptionAcquisitionInFlight(agentId)).toBe(false);
    expect(hasStandingChatSubscription(agentId)).toBe(false);
  });

  describe('chief-workspace exemption from the viewed-agent swap (monorepo#1421)', () => {
    const CHIEF_AGENT = 'agent-sub-chief';

    function seedChiefSession(agentId: string): void {
      seedSession(agentId, { workspaceId: CHIEF_WORKSPACE_ID });
    }

    function openChiefChat(agentId: string): FakeSubscription {
      appStore.dispatch(initializeChatRequested(agentId, { wsId: CHIEF_WORKSPACE_ID }));
      const sub = fakeSubscriptions.find((s) => s.agentId === agentId);
      if (!sub) throw new Error(`no chat.subscribe recorded for ${agentId}`);
      return sub;
    }

    it('keeps the chief subscription open — and live — when a workspace agent is marked as viewed', () => {
      const workspaceAgent = 'agent-sub-chief-ws-viewed';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);

      // The user opens a workspace chat while the Chief sidebar panel stays
      // mounted. The viewed-agent swap must not tear down the chief stream.
      openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      expect(chiefSub.unsubscribe).not.toHaveBeenCalled();

      // A live emit for the chief agent must still apply to the store.
      chiefSub.handler(transcript([makeMessage('chief-live', 'still streaming')], true));
      expect(selectAgentMessages.select(appStore.state, CHIEF_AGENT).map((m) => m.id)).toContain(
        'chief-live',
      );
    });

    it("does not close the viewed workspace agent's subscription when the chief agent is marked as viewed (symmetric)", () => {
      const workspaceAgent = 'agent-sub-chief-symmetric';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // Focusing the Chief panel marks its agent as viewed — the open
      // workspace chat's subscription must survive the swap.
      openChiefChat(CHIEF_AGENT);
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));

      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
      wsSub.handler(transcript([makeMessage('ws-live', 'still streaming')], true));
      expect(selectAgentMessages.select(appStore.state, workspaceAgent).map((m) => m.id)).toContain(
        'ws-live',
      );
    });

    it("viewing one chief thread still closes another chief thread's subscription", () => {
      const otherChiefThread = 'agent-sub-chief-thread-b';
      seedChiefSession(CHIEF_AGENT);
      seedChiefSession(otherChiefThread);
      const threadASub = openChiefChat(CHIEF_AGENT);
      openChiefChat(otherChiefThread);

      appStore.dispatch(markAgentAsViewed(otherChiefThread));

      expect(threadASub.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('spares the chief subscription when closing the last viewed workspace chat clears the viewed agent', () => {
      const workspaceAgent = 'agent-sub-chief-chat-close';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // The chat area closes: the applied clear tears down workspace
      // subscriptions but the chief panel is still open in the sidebar.
      appStore.dispatch(clearCurrentlyViewedAgent(workspaceAgent));
      expect(wsSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(chiefSub.unsubscribe).not.toHaveBeenCalled();
    });

    it('a clear scoped to the chief agent closes exactly the chief subscription, even while a workspace agent stays viewed', () => {
      const workspaceAgent = 'agent-sub-chief-scoped-clear';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // ChiefCard collapse / thread-switch destroy: the swap exempts chief
      // subscriptions, so this scoped clear is their only viewed-lifecycle
      // teardown — and it must not touch the still-viewed workspace chat.
      appStore.dispatch(clearCurrentlyViewedAgent(CHIEF_AGENT));
      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
    });

    it('a scoped chief clear while the chief agent is itself viewed spares the workspace subscription (applied clear + chief branch)', () => {
      const workspaceAgent = 'agent-sub-chief-viewed-clear';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));

      // ChiefCard collapse while focused: the reducer applies the clear
      // (viewed → null) AND the chief branch runs — the workspace chat's
      // still-mounted panel must keep its subscription (no close-all).
      appStore.dispatch(clearCurrentlyViewedAgent(CHIEF_AGENT));
      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
    });

    it('classifies the chief agent from its stored session when no subscription entry exists (readSession fallback)', () => {
      const workspaceAgent = 'agent-sub-chief-session-fallback';
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // Chief agent viewed with a seeded session but NO prior chief
      // subscription: the swap must classify it as chief via the session's
      // workspaceId — sparing the workspace subscription — and (re)open the
      // chief subscription.
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === CHIEF_AGENT)).toHaveLength(1);
    });

    it('still closes chief subscriptions on removeWorkspaceSessions for the chief workspace', () => {
      seedChiefSession(CHIEF_AGENT);
      const chiefSub = openChiefChat(CHIEF_AGENT);

      appStore.dispatch(removeWorkspaceSessions(CHIEF_WORKSPACE_ID));

      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('live stream phase mirroring', () => {
    const phaseOf = (agentId: string) => selectChatLiveStreamPhase.select(appStore.state, agentId);

    it('mirrors onPhase reports into the chat-state slice', () => {
      const agentId = 'agent-sub-phase-mirror';
      seedSession(agentId);
      const sub = openChat(agentId);
      expect(sub.onPhase).toBeDefined();

      sub.onPhase!('connecting');
      expect(phaseOf(agentId)).toBe('connecting');
      sub.onPhase!('awaiting-snapshot');
      expect(phaseOf(agentId)).toBe('awaiting-snapshot');
      sub.onPhase!('live');
      expect(phaseOf(agentId)).toBe('live');
      sub.onPhase!('resyncing');
      expect(phaseOf(agentId)).toBe('resyncing');
      sub.onPhase!('delayed');
      expect(phaseOf(agentId)).toBe('delayed');
    });

    it('resets the phase to null on every subscription teardown path', () => {
      // removeSession (agent-deletion soft-hide).
      const agentA = 'agent-sub-phase-remove';
      seedSession(agentA);
      openChat(agentA).onPhase!('connecting');
      expect(phaseOf(agentA)).toBe('connecting');
      appStore.dispatch(removeSession(agentA));
      expect(phaseOf(agentA)).toBeNull();

      // clearAllSessions.
      const agentB = 'agent-sub-phase-clearall';
      seedSession(agentB);
      openChat(agentB).onPhase!('awaiting-snapshot');
      expect(phaseOf(agentB)).toBe('awaiting-snapshot');
      appStore.dispatch(clearAllSessions());
      expect(phaseOf(agentB)).toBeNull();

      // workspaceDeleted (drops the whole chat-state entry too).
      const agentC = 'agent-sub-phase-wsdel';
      seedSession(agentC);
      openChat(agentC).onPhase!('resyncing');
      expect(phaseOf(agentC)).toBe('resyncing');
      appStore.dispatch(workspaceDeleted(WS, [agentC]));
      expect(phaseOf(agentC)).toBeNull();

      // clearCurrentlyViewedAgent with no agent left viewed (chat close).
      const agentD = 'agent-sub-phase-clearview';
      seedSession(agentD);
      appStore.dispatch(markAgentAsViewed(agentD));
      openChat(agentD).onPhase!('delayed');
      expect(phaseOf(agentD)).toBe('delayed');
      appStore.dispatch(clearCurrentlyViewedAgent(agentD));
      expect(phaseOf(agentD)).toBeNull();
    });

    it("resets the phase on agent switch (markAgentAsViewed closes the other agent's stream)", () => {
      const agentA = 'agent-sub-phase-switch-a';
      const agentB = 'agent-sub-phase-switch-b';
      seedSession(agentA);
      seedSession(agentB);
      openChat(agentA).onPhase!('awaiting-snapshot');
      expect(phaseOf(agentA)).toBe('awaiting-snapshot');

      appStore.dispatch(markAgentAsViewed(agentB));
      expect(phaseOf(agentA)).toBeNull();
    });

    it('ignores phase reports from a superseded subscription entry', () => {
      const agentId = 'agent-sub-phase-stale';
      seedSession(agentId);
      const stale = openChat(agentId);
      stale.onPhase!('live');
      appStore.dispatch(removeSession(agentId));
      expect(phaseOf(agentId)).toBeNull();

      // A late report from the closed entry must not resurrect a phase.
      stale.onPhase!('delayed');
      expect(phaseOf(agentId)).toBeNull();
    });
  });

  describe('switch-back transcript reveal gate (saga fallback)', () => {
    const gateOf = (agentId: string) =>
      selectAwaitingSwitchBackSnapshot.select(appStore.state, agentId);

    /**
     * Hydrated-once conversation whose subscription was closed by a switch
     * away (transcriptSnapshot dropped) — the exact switch-back precondition.
     */
    function hydrateAndSwitchAway(agentId: string, otherId: string): FakeSubscription {
      seedSession(agentId);
      seedSession(otherId);
      const sub = openChat(agentId);
      appStore.dispatch(markAgentAsViewed(agentId));
      sub.handler({ ...transcript([makeMessage('m-sb-1', 'hello')]), fromSnapshot: true });
      appStore.dispatch(transcriptHydrationStarted(agentId));
      appStore.dispatch(transcriptHydrationSettled(agentId));
      appStore.dispatch(markAgentAsViewed(otherId));
      expect(sub.unsubscribe).toHaveBeenCalledOnce();
      expect(gateOf(agentId)).toBe(false);
      return sub;
    }

    it('arms on switch-back and clears when the reopening subscription snapshot applies', async () => {
      const agentId = 'agent-sub-swbk-snapshot';
      hydrateAndSwitchAway(agentId, 'agent-sub-swbk-snapshot-other');

      appStore.dispatch(markAgentAsViewed(agentId));
      expect(gateOf(agentId)).toBe(true);

      await vi.waitFor(() => {
        expect(fakeSubscriptions.filter((s) => s.agentId === agentId)).toHaveLength(2);
      });
      const reopened = [...fakeSubscriptions].reverse().find((s) => s.agentId === agentId)!;
      reopened.handler({ ...transcript([makeMessage('m-sb-2', 'fresh')]), fromSnapshot: true });
      expect(gateOf(agentId)).toBe(false);
    });

    it('clears via the bounded fallback timeout when no snapshot arrives', async () => {
      vi.useFakeTimers();
      try {
        const agentId = 'agent-sub-swbk-timeout';
        hydrateAndSwitchAway(agentId, 'agent-sub-swbk-timeout-other');

        appStore.dispatch(markAgentAsViewed(agentId));
        expect(gateOf(agentId)).toBe(true);

        // Just before the bound: still deferring.
        await vi.advanceTimersByTimeAsync(SWITCH_BACK_REVEAL_WAIT_MS - 50);
        expect(gateOf(agentId)).toBe(true);
        // The bound elapses: the gate clears (retained transcript shows).
        await vi.advanceTimersByTimeAsync(100);
        expect(gateOf(agentId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not arm a fallback timer when the gate did not arm (first hydration)', async () => {
      vi.useFakeTimers();
      try {
        const agentId = 'agent-sub-swbk-first';
        seedSession(agentId);
        // First view: never hydrated — the reducer never arms the gate.
        appStore.dispatch(markAgentAsViewed(agentId));
        expect(gateOf(agentId)).toBe(false);
        await vi.advanceTimersByTimeAsync(SWITCH_BACK_REVEAL_WAIT_MS + 100);
        expect(gateOf(agentId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a switch away (subscription close) clears the gate and retires the timer harmlessly', async () => {
      vi.useFakeTimers();
      try {
        const agentId = 'agent-sub-swbk-away';
        const otherId = 'agent-sub-swbk-away-other';
        hydrateAndSwitchAway(agentId, otherId);

        appStore.dispatch(markAgentAsViewed(agentId));
        expect(gateOf(agentId)).toBe(true);

        // Switch away again before any snapshot: phase-null teardown clears
        // the gate (the backgrounded panel keeps its retained transcript).
        // The close settles through the slot worker's queued transitions.
        appStore.dispatch(markAgentAsViewed(otherId));
        await vi.advanceTimersByTimeAsync(0);
        expect(gateOf(agentId)).toBe(false);

        // The pending timer must not re-clear or throw after the bound.
        await vi.advanceTimersByTimeAsync(SWITCH_BACK_REVEAL_WAIT_MS + 100);
        expect(gateOf(agentId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a re-dispatched markAgentAsViewed supersedes the previous fallback watcher', async () => {
      vi.useFakeTimers();
      try {
        const agentId = 'agent-sub-swbk-redispatch';
        hydrateAndSwitchAway(agentId, 'agent-sub-swbk-redispatch-other');

        appStore.dispatch(markAgentAsViewed(agentId));
        expect(gateOf(agentId)).toBe(true);

        // Re-dispatch while the gate is still armed: the first watcher
        // retires and a single fresh one owns the full bounded wait from now.
        await vi.advanceTimersByTimeAsync(1_000);
        appStore.dispatch(markAgentAsViewed(agentId));
        expect(gateOf(agentId)).toBe(true);

        // Past the FIRST watcher's deadline: a surviving duplicate would
        // have cleared the gate here.
        await vi.advanceTimersByTimeAsync(SWITCH_BACK_REVEAL_WAIT_MS - 500);
        expect(gateOf(agentId)).toBe(true);

        // The superseding watcher's own bound elapses: the gate clears.
        await vi.advanceTimersByTimeAsync(600);
        expect(gateOf(agentId)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types/agent-session';

// FAKE seam: appClient.agents.get is stubbed so no daemon call (and never a
// mutation) happens. The service runs against the REAL configured store so the
// ensureAgentSessionLoaded middleware, refresh dedup, and upsert hydration are
// exercised end to end. READ-ONLY: only `get` is stubbed.
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      get: vi.fn(() => Promise.resolve(null as AgentSession | null)),
    },
  },
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => loggerMocks,
  logger: loggerMocks,
}));

import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';

const testStore = appStore as typeof appStore & {
  storeContext?: unknown;
  getExistingStoreContext(): unknown;
};
testStore.getExistingStoreContext = function () {
  return this.storeContext;
};
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectAgentMessages,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { AgentMessage } from '$shared/types';
import {
  ensureAgentSession,
  readAgentSession,
  refreshAgentSessionAfterEvent,
} from './agent-read-service';
import {
  clearPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from './utils/pending-agent-deletions';

const agentsApi = appClient.agents as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = 'ws-agent-read-1';
const AGENT = 'agent-read-1';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    backendSessionId: null,
    workspaceId: WS,
    name: 'Agent One',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

describe('agentReadService (fake seam, real store)', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    clearPendingAgentDeletions();
    agentsApi.get.mockResolvedValue(null as never);
  });

  it('ensureAgentSession fetches via the seam and hydrates the store', async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession({ name: 'fetched' }) as never);

    await ensureAgentSession(AGENT);

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
    expect(selectAgentSession.select(appStore.state, AGENT)?.name).toBe('fetched');
  });

  it('leaves any prior session intact when the read fails', async () => {
    const agentId = 'agent-read-prior';
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: 'prior' }) as never);
    await ensureAgentSession(agentId);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('prior');

    agentsApi.get.mockRejectedValueOnce(new Error('boom') as never);
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('prior');
  });

  // Regression (monorepo#1753): a speculative load (hover card, avatar, peek
  // card) referencing an agent deleted on the daemon rejects with -32602
  // "Agent not found" — an expected condition that logs one WARN, never ERROR.
  it('logs WARN (not ERROR) and leaves prior session intact on agent-not-found', async () => {
    const agentId = 'agent-read-not-found';
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: 'prior' }) as never);
    await ensureAgentSession(agentId);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('prior');

    // Legacy/lossy shape without the structured data.code: pins the
    // rpcCode + message fallback branch of the classifier.
    const notFound = Object.assign(new Error('Agent not found'), {
      name: 'BackendError',
      code: 'INVALID_PARAMS',
      rpcCode: -32602,
    });
    agentsApi.get.mockRejectedValueOnce(notFound as never);
    loggerMocks.warn.mockClear();
    loggerMocks.error.mockClear();
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('prior');
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  // Regression: with a soft-hidden deletion pending, the daemon still returns
  // the agent from `agent.get`, so an `agent:created`/`agent:updated`-driven
  // ensureAgentSession refetch used to resurrect the deleted session.
  it('is a no-op while a soft-hidden deletion is pending for the agent', async () => {
    const agentId = 'agent-read-pending-del';
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession({ id: agentId }),
      timer: null,
    });
    try {
      await ensureAgentSession(agentId);
      expect(agentsApi.get).not.toHaveBeenCalled();
      expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    } finally {
      removePendingAgentDeletion(agentId);
    }

    // Once the pending entry is gone (undo or commit), loads work again.
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: 'revived' }) as never);
    await ensureAgentSession(agentId);
    expect(agentsApi.get).toHaveBeenCalledWith(agentId);
  });

  // Regression (monorepo#1977): a deletion scheduled by ANOTHER window/client
  // (or before an FE restart) is not in this window's local pending-delete
  // registry — the fetched row's daemon-owned `pendingDeleteAt` deadline
  // (PROTOCOL §5.5, v6.7+) is the only signal, and it must not be upserted.
  it('drops a fetched row carrying pendingDeleteAt (deletion scheduled elsewhere)', async () => {
    const agentId = 'agent-read-wire-pending-del';
    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, pendingDeleteAt: '2026-01-01T00:00:15.000Z' }) as never,
    );

    await ensureAgentSession(agentId);

    expect(agentsApi.get).toHaveBeenCalledWith(agentId);
    expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
  });

  // Regression (PR review): if the deletion becomes pending WHILE the
  // `agent.get` fetch is in flight, the resolved response must not be
  // upserted — otherwise the soft-hidden agent is resurrected anyway.
  it('discards an in-flight fetch result when a deletion becomes pending mid-request', async () => {
    const agentId = 'agent-read-midflight-del';
    let resolveGet!: (value: unknown) => void;
    agentsApi.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGet = resolve;
      }) as never,
    );

    const load = ensureAgentSession(agentId);
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession({ id: agentId }),
      timer: null,
    });
    try {
      resolveGet(makeSession({ id: agentId, name: 'stale' }));
      await load;
      expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    } finally {
      removePendingAgentDeletion(agentId);
    }
  });

  it('coalesces concurrent loads for the same agent into one fetch', async () => {
    agentsApi.get.mockResolvedValue(makeSession({ name: 'shared' }) as never);

    await Promise.all([
      ensureAgentSession(AGENT),
      ensureAgentSession(AGENT),
      ensureAgentSession(AGENT),
    ]);

    expect(agentsApi.get).toHaveBeenCalledTimes(1);
  });

  it('shares one request between a raw caller and the guarded hydrator', async () => {
    const agentId = 'agent-read-cross-caller';
    let resolveGet!: (value: AgentSession) => void;
    agentsApi.get.mockReturnValueOnce(
      new Promise<AgentSession>((resolve) => {
        resolveGet = resolve;
      }) as never,
    );

    const rawCaller = readAgentSession(agentId);
    const hydratedCaller = ensureAgentSession(agentId);
    expect(agentsApi.get).toHaveBeenCalledTimes(1);

    resolveGet(makeSession({ id: agentId, name: 'shared across callers' }));
    await Promise.all([rawCaller, hydratedCaller]);

    expect(agentsApi.get).toHaveBeenCalledTimes(1);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('shared across callers');
  });

  it('does not cache a rejected request', async () => {
    const agentId = 'agent-read-retry-after-rejection';
    agentsApi.get
      .mockRejectedValueOnce(new Error('temporary failure') as never)
      .mockResolvedValueOnce(makeSession({ id: agentId, name: 'retry succeeded' }) as never);

    await ensureAgentSession(agentId);
    await ensureAgentSession(agentId);

    expect(agentsApi.get).toHaveBeenCalledTimes(2);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('retry succeeded');
  });

  it('runs exactly one trailing refresh when events arrive during a raw caller request', async () => {
    const agentId = 'agent-read-event-during-raw';
    let resolveLeading!: (value: AgentSession) => void;
    agentsApi.get
      .mockImplementationOnce(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveLeading = resolve;
          }) as never,
      )
      .mockResolvedValueOnce(makeSession({ id: agentId, name: 'trailing' }) as never);

    const leading = readAgentSession(agentId);
    const trailing = refreshAgentSessionAfterEvent(agentId);
    const duplicateEvent = refreshAgentSessionAfterEvent(agentId);
    expect(agentsApi.get).toHaveBeenCalledTimes(1);

    resolveLeading(makeSession({ id: agentId, name: 'leading' }));
    await Promise.all([leading, trailing, duplicateEvent]);

    expect(agentsApi.get).toHaveBeenCalledTimes(2);
    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('trailing');
  });

  it.each([
    {
      direction: 'clear to set',
      firstMarker: '',
      latestMarker: 'msg-new-pending',
    },
    {
      direction: 'set to clear',
      firstMarker: 'msg-old-pending',
      latestMarker: '',
    },
  ])(
    'runs one trailing event refresh so a $direction burst converges to the newest marker',
    async ({ direction, firstMarker, latestMarker }) => {
      const agentId = `agent-marker-${direction.replaceAll(' ', '-')}`;
      let resolveFirst!: (session: AgentSession) => void;
      let resolveSecond!: (session: AgentSession) => void;
      agentsApi.get
        .mockImplementationOnce(
          () =>
            new Promise<AgentSession>((resolve) => {
              resolveFirst = resolve;
            }) as never,
        )
        .mockImplementationOnce(
          () =>
            new Promise<AgentSession>((resolve) => {
              resolveSecond = resolve;
            }) as never,
        );

      const leading = ensureAgentSession(agentId);
      const trailing = refreshAgentSessionAfterEvent(agentId);
      const duplicateEvent = refreshAgentSessionAfterEvent(agentId);
      expect(agentsApi.get).toHaveBeenCalledTimes(1);

      resolveFirst(
        makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: firstMarker } }),
      );
      await leading;
      await vi.waitFor(() => expect(agentsApi.get).toHaveBeenCalledTimes(2));

      resolveSecond(
        makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: latestMarker } }),
      );
      await Promise.all([trailing, duplicateEvent]);

      expect(agentsApi.get).toHaveBeenCalledTimes(2);
      expect(
        selectAgentSession.select(appStore.state, agentId)?.metadata?.pendingQuestionsMessageId,
      ).toBe(latestMarker);
    },
  );

  // Regression: `agent.get` returns AgentLite (PROTOCOL §5.5) — session
  // metadata + message COUNTS, not the retained transcript. Dispatching that
  // response as-is used to clobber a transcript that `chat-read-service`
  // hydrated via `agent.getConversation`, so the initial user message
  // (seq 0) — and any user follow-ups — disappeared the moment any AgentCard
  // / hover surface dispatched `ensureAgentSessionLoaded`. This service must
  // now preserve the existing transcript on this metadata-only refresh.
  it('does not clobber the existing transcript when agent.get returns no messages', async () => {
    const agentId = 'agent-transcript-preserve';
    const existingMessages: AgentMessage[] = [
      {
        id: '019f3d27-user-seq0',
        role: 'user',
        timestamp: '2026-07-07T15:17:03.908Z',
        contentBlocks: [{ type: 'text', text: 'describe the repo' }],
      },
      {
        id: '019f3d27-asst-seq1',
        role: 'assistant',
        timestamp: '2026-07-07T15:17:04.100Z',
        contentBlocks: [{ type: 'text', text: 'here is the repo description' }],
      },
    ];
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ id: agentId, name: 'seeded', messages: existingMessages }),
      ]),
    );
    expect(selectAgentMessages.select(appStore.state, agentId).length).toBe(2);

    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, name: 'refreshed', messages: [] }) as never,
    );
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('refreshed');
    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored.map((m) => m.id)).toEqual(['019f3d27-user-seq0', '019f3d27-asst-seq1']);
    expect(stored[0].role).toBe('user');
  });

  // Regression (monorepo#1250): a daemon crash mid-turn leaves the store with
  // the both-true isStreaming/isProcessing pair that no stream-end event will
  // ever clear. When this authoritative refetch returns an idle session, the
  // explicit-false flags must win over the upsert pair-guard.
  it('clears a crash-orphaned runtime-flag pair when the refetched session is idle', async () => {
    const agentId = 'agent-stale-pair-clear';
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({
          id: agentId,
          status: AgentStatus.Active,
          isResponding: true,
          isProcessing: true,
          isStreaming: true,
        }),
      ]),
    );

    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Idle,
        isResponding: false,
        isProcessing: false,
        isStreaming: false,
      }) as never,
    );
    await ensureAgentSession(agentId);

    const stored = selectAgentSession.select(appStore.state, agentId);
    expect(stored?.isStreaming).toBe(false);
    expect(stored?.isProcessing).toBe(false);
    expect(stored?.isResponding).toBe(false);
  });

  // Companion (monorepo#1250 non-goal): when the daemon reports the turn
  // still in flight, the pre-existing pair is genuinely live and survives.
  it('keeps the runtime-flag pair when the refetched session reports the turn in flight', async () => {
    const agentId = 'agent-live-pair-keep';
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({
          id: agentId,
          status: AgentStatus.Active,
          isResponding: true,
          isProcessing: true,
          isStreaming: true,
        }),
      ]),
    );

    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Active,
        isResponding: true,
        isProcessing: true,
        isStreaming: true,
      }) as never,
    );
    await ensureAgentSession(agentId);

    const stored = selectAgentSession.select(appStore.state, agentId);
    expect(stored?.isStreaming).toBe(true);
    expect(stored?.isProcessing).toBe(true);
  });

  // Regression: ensureAgentSession must preserve existing messages even when
  // the existing messages array exists but is empty (e.g., during the window
  // between session creation and transcript hydration), because agent.get
  // always returns AgentLite (messages normalized to []).
  it('preserves existing messages array even when empty', async () => {
    const agentId = 'agent-preserve-empty';
    appStore.dispatch(
      bulkUpsertSessions([makeSession({ id: agentId, name: 'initial', messages: [] })]),
    );
    expect(selectAgentMessages.select(appStore.state, agentId).length).toBe(0);

    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, name: 'refreshed', messages: [] }) as never,
    );
    await ensureAgentSession(agentId);

    expect(selectAgentSession.select(appStore.state, agentId)?.name).toBe('refreshed');
    // Empty array should be preserved (not replaced with a different empty array)
    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored).toEqual([]);
  });
});

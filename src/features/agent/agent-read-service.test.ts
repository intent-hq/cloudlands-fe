import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types/agent-session';

const reconnectCallbacks = vi.hoisted(() => new Set<() => void>());
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  onBackendReconnected: vi.fn((callback: () => void) => {
    reconnectCallbacks.add(callback);
    return () => reconnectCallbacks.delete(callback);
  }),
}));

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
import {
  bulkUpsertSessions,
  clearProcessQueueHint,
  setProcessQueueHint,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  selectAgentMessages,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { AgentMessage } from '$shared/types';
import {
  ensureAgentSession,
  notePendingQuestionMarkerProjection,
  readAgentSession,
  readAgentSessionAfterCurrent,
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

  it.each(['resolve', 'reject'] as const)(
    'fresh confirmation drains an older %s and coalesces concurrent barriers without hydration',
    async (outcome) => {
      const id = `confirm-raw-${outcome}`;
      const stored = makeSession({ id, name: 'local transcript owner' });
      appStore.dispatch(bulkUpsertSessions([stored]));
      let resolveOld!: (value: AgentSession) => void;
      let rejectOld!: (reason: Error) => void;
      const pending = new Promise<AgentSession>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      let resolveFresh!: (value: AgentSession) => void;
      const fresh = new Promise<AgentSession>((resolve) => {
        resolveFresh = resolve;
      });
      agentsApi.get.mockReturnValueOnce(pending).mockReturnValueOnce(fresh);
      const leading = readAgentSession(id, WS).catch(() => null);
      const first = readAgentSessionAfterCurrent(id, WS, () => true);
      const second = readAgentSessionAfterCurrent(id, WS, () => true);
      expect(agentsApi.get).toHaveBeenCalledTimes(1);
      if (outcome === 'resolve') resolveOld(makeSession({ id, name: 'old idle' }));
      else rejectOld(new Error('leading failed'));
      await leading;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(agentsApi.get).toHaveBeenCalledTimes(2);
      resolveFresh(makeSession({ id, name: 'fresh idle' }));
      expect((await first)?.name).toBe('fresh idle');
      expect((await second)?.name).toBe('fresh idle');
      expect(selectAgentSession.select(appStore.state, id)?.name).toBe('local transcript owner');
    },
  );

  it.each(['caller', 'reconnect', 'workspace', 'principal'] as const)(
    'fresh confirmation never follows a stale leading read after %s changes',
    async (change) => {
      if (change === 'principal') {
        const { admitLegacyPrincipal } = await import('../../test/fixtures/principal-state');
        admitLegacyPrincipal();
      }
      const id = `confirm-raw-stale-${change}`;
      appStore.dispatch(bulkUpsertSessions([makeSession({ id })]));
      let resolveOld!: (value: AgentSession) => void;
      agentsApi.get.mockImplementationOnce(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveOld = resolve;
          }),
      );
      const leading = readAgentSession(id, WS);
      let current = true;
      const confirmation = readAgentSessionAfterCurrent(id, WS, () => current);
      if (change === 'caller') current = false;
      if (change === 'reconnect') for (const callback of reconnectCallbacks) callback();
      if (change === 'workspace') {
        const { claimAgentReadOwnership } = await import('./agent-read-ownership');
        claimAgentReadOwnership(id, 'other');
        claimAgentReadOwnership(id, WS);
      }
      if (change === 'principal') {
        const { principalIdentityChanged } =
          await import('$store/renderer/slices/principal/principal-slice');
        appStore.dispatch(principalIdentityChanged(appStore.state.principal.boundPrincipalId!));
      }
      resolveOld(makeSession({ id }));
      await leading;
      expect(await confirmation).toBeNull();
      expect(agentsApi.get).toHaveBeenCalledTimes(1);
    },
  );

  it('fences old detail reads across principal invalidation and session re-admission', async () => {
    const { admitLegacyPrincipal } = await import('../../test/fixtures/principal-state');
    const { principalIdentityChanged, principalReceived } =
      await import('$store/renderer/slices/principal/principal-slice');
    admitLegacyPrincipal();
    const principalSnapshot = appStore.state.principal.snapshot!;
    const id = 'principal-fenced-detail';
    appStore.dispatch(bulkUpsertSessions([makeSession({ id, metadata: { provider: 'old' } })]));
    appStore.dispatch(
      updateSession(id, { metadataPatch: { provider: { op: 'set', value: 'old' } } }),
    );
    expect(appStore.state.agentSessions.projectionVersions?.[id]?.metadata).toEqual({
      provider: 1,
    });
    let resolveOld!: (value: AgentSession) => void;
    agentsApi.get.mockImplementationOnce(
      () =>
        new Promise<AgentSession>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = ensureAgentSession(id, WS);
    appStore.dispatch(principalIdentityChanged(appStore.state.principal.boundPrincipalId!));
    appStore.dispatch(removeSession(id));
    expect(appStore.state.agentSessions.projectionVersions?.[id]).toBeUndefined();
    const principal = appStore.state.principal;
    appStore.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: principal.invalidation,
          presentationVersion: principal.presentationVersion,
        },
        principalSnapshot,
      ),
    );
    appStore.dispatch(bulkUpsertSessions([makeSession({ id, metadata: { provider: 'new' } })]));
    let resolveFresh!: (value: AgentSession) => void;
    agentsApi.get.mockImplementationOnce(
      () =>
        new Promise<AgentSession>((resolve) => {
          resolveFresh = resolve;
        }),
    );
    const fresh = ensureAgentSession(id, WS);
    appStore.dispatch(
      updateSession(id, { metadataPatch: { provider: { op: 'set', value: 'new' } } }),
    );
    resolveFresh(
      makeSession({
        id,
        name: 'new authority',
        metadata: { provider: 'stale', taskNoteId: 'new-task' },
      }),
    );
    await fresh;
    const projected = appStore.state.agentSessions.projectionVersions?.[id];
    expect(projected).toEqual({ fields: {}, metadata: { provider: 1 } });
    resolveOld(
      makeSession({
        id,
        name: 'old authority',
        metadata: { provider: 'old', taskNoteId: 'old-task' },
      }),
    );
    await old;
    const stored = selectAgentSession.select(appStore.state, id);
    expect(stored?.name).toBe('new authority');
    expect(stored?.metadata).toEqual({ provider: 'new', taskNoteId: 'new-task' });
    expect(appStore.state.agentSessions.projectionVersions?.[id]).toEqual(projected);
    expect(agentsApi.get.mock.calls).toEqual([
      [id, WS],
      [id, WS],
    ]);
  });

  it('hydrates special and untouched keys while preserving ABA and explicit absent clears', async () => {
    const id = 'hydrated-metadata-ownership';
    const seed = makeSession({
      id,
      metadata: { specialist: 'original', ['__proto__']: 'local', provider: 'before' },
    });
    appStore.dispatch(bulkUpsertSessions([seed]));
    let finish!: (value: AgentSession) => void;
    agentsApi.get.mockImplementationOnce(
      () =>
        new Promise<AgentSession>((resolve) => {
          finish = resolve;
        }),
    );
    const read = ensureAgentSession(id, WS);
    appStore.dispatch(
      updateSession(id, {
        metadataPatch: {
          specialist: { op: 'set', value: 'temporary' },
          ['__proto__']: { op: 'set', value: 'local' },
          attentionReason: { op: 'clear' },
          ['toString']: { op: 'clear' },
        },
      }),
    );
    appStore.dispatch(
      updateSession(id, {
        metadataPatch: {
          specialist: { op: 'clear' },
          ['__proto__']: { op: 'set', value: 'local' },
          attentionReason: { op: 'clear' },
        },
      }),
    );
    appStore.dispatch(
      updateSession(id, { metadataPatch: { specialist: { op: 'set', value: 'original' } } }),
    );
    const projected = appStore.state.agentSessions.projectionVersions?.[id];
    expect(projected).toEqual({
      fields: {},
      metadata: {
        specialist: 3,
        ['__proto__']: 2,
        attentionReason: 2,
        ['toString']: 1,
      },
    });
    finish(
      makeSession({
        id,
        // Exercise a real store upsert: extension-only same-timestamp equivalence
        // is an existing optimization and is not the contract under test here.
        name: 'Fresh detail was hydrated',
        metadata: {
          specialist: 'stale',
          ['__proto__']: 'stale',
          attentionReason: 'stale',
          ['toString']: 'stale',
          ['constructor']: 'fetched-special',
          provider: 'fetched-provider',
          unrelated: 'fetched-extension',
        },
      }),
    );
    await read;
    const stored = selectAgentSession.select(appStore.state, id)!;
    expect(stored.name).toBe('Fresh detail was hydrated');
    expect(stored.metadata).toEqual({
      specialist: 'original',
      ['__proto__']: 'local',
      ['constructor']: 'fetched-special',
      provider: 'fetched-provider',
      unrelated: 'fetched-extension',
    });
    expect(Object.hasOwn(stored.metadata!, '__proto__')).toBe(true);
    expect(Object.hasOwn(stored.metadata!, 'constructor')).toBe(true);
    expect(Object.hasOwn(stored.metadata!, 'attentionReason')).toBe(false);
    expect(Object.hasOwn(stored.metadata!, 'toString')).toBe(false);
    expect(Object.getPrototypeOf(stored.metadata)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(stored.metadata))).toEqual(stored.metadata);
    expect(appStore.state.agentSessions.projectionVersions?.[id]).toEqual(projected);
    expect(appStore.state.agentSessions.detailHydrated?.[id]).toBe(true);
    expect(agentsApi.get.mock.calls).toEqual([[id, WS]]);
  });

  it('does not restore detail hydration from a response invalidated by the principal', async () => {
    const { admitLegacyPrincipal } = await import('../../test/fixtures/principal-state');
    const { principalIdentityChanged } =
      await import('$store/renderer/slices/principal/principal-slice');
    admitLegacyPrincipal();
    const id = 'principal-dropped-detail';
    let resolveOld!: (value: AgentSession) => void;
    agentsApi.get.mockImplementationOnce(
      () =>
        new Promise<AgentSession>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = ensureAgentSession(id, WS);
    appStore.dispatch(principalIdentityChanged(appStore.state.principal.boundPrincipalId!));
    resolveOld(makeSession({ id }));
    await old;
    expect(appStore.state.agentSessions.detailHydrated?.[id]).not.toBe(true);
    expect(selectAgentSession.select(appStore.state, id)).toBeUndefined();
  });

  it('ensureAgentSession fetches via the seam and hydrates the store', async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession({ name: 'fetched' }) as never);

    await ensureAgentSession(AGENT);

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT, undefined);
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
    expect(agentsApi.get).toHaveBeenCalledWith(agentId, undefined);
  });

  // Regression (monorepo#1977): a deletion scheduled by ANOTHER window/client
  // (or before an FE restart) is not in this window's local pending-delete
  // registry — the fetched row's daemon-owned `pendingDeleteAt` deadline
  // (PROTOCOL §5.5 delete grace window) is the only signal, and it must not be upserted.
  it('drops a fetched row carrying pendingDeleteAt (deletion scheduled elsewhere)', async () => {
    const agentId = 'agent-read-wire-pending-del';
    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, pendingDeleteAt: '2026-01-01T00:00:15.000Z' }) as never,
    );

    await ensureAgentSession(agentId);

    expect(agentsApi.get).toHaveBeenCalledWith(agentId, undefined);
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

  // A read whose request started before an `agent:updated` question-marker
  // projection (§6.5) may carry the pre-mutation marker; its response must not
  // undo the store's projected value, while a read started after the
  // projection stays authoritative.
  it('keeps the projected question marker against a read that started before the projection', async () => {
    const agentId = 'agent-marker-stale-read';
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: 'msg-q1' } }),
      ]),
    );
    let resolveStale!: (session: AgentSession) => void;
    agentsApi.get
      .mockImplementationOnce(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveStale = resolve;
          }) as never,
      )
      .mockResolvedValueOnce(
        makeSession({
          id: agentId,
          metadata: { pendingQuestionsMessageId: '', specialist: 'implementor' },
        }) as never,
      );

    const stale = ensureAgentSession(agentId);
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: '' } }),
      ]),
    );
    notePendingQuestionMarkerProjection(agentId);
    const trailing = refreshAgentSessionAfterEvent(agentId);

    resolveStale(
      makeSession({
        id: agentId,
        name: 'stale',
        metadata: { pendingQuestionsMessageId: 'msg-q1', taskNoteId: 'task-1' },
      }),
    );
    await stale;
    const afterStale = selectAgentSession.select(appStore.state, agentId);
    expect(afterStale?.name).toBe('stale');
    expect(afterStale?.metadata).toEqual({ pendingQuestionsMessageId: '', taskNoteId: 'task-1' });

    await trailing;
    expect(selectAgentSession.select(appStore.state, agentId)?.metadata).toEqual({
      pendingQuestionsMessageId: '',
      specialist: 'implementor',
    });
  });

  it('applies the fetched question marker from a read that started after the projection', async () => {
    const agentId = 'agent-marker-fresh-read';
    appStore.dispatch(
      bulkUpsertSessions([
        makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: '' } }),
      ]),
    );
    notePendingQuestionMarkerProjection(agentId);
    agentsApi.get.mockResolvedValueOnce(
      makeSession({ id: agentId, metadata: { pendingQuestionsMessageId: 'msg-q2' } }) as never,
    );

    await ensureAgentSession(agentId);

    expect(
      selectAgentSession.select(appStore.state, agentId)?.metadata?.pendingQuestionsMessageId,
    ).toBe('msg-q2');
  });

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

  // Regression (cloudlands-fe#2443 review): `processQueueHint` is FE-owned —
  // set from `agent:process:queued` (§6.5), never on the `agent.get` wire — so
  // the event-driven refetch (agent:updated → refreshAgentSessionAfterEvent →
  // agent.get → bulkUpsertSessions) used to rebuild the session without it and
  // the chat slot-wait warning flickered off on every unrelated agent event.
  describe('processQueueHint across the event-driven refetch', () => {
    const HINT = { waiting: true, used: 3, cap: 3, reason: 'slots' as const };
    const queuedSession = (agentId: string) =>
      makeSession({
        id: agentId,
        status: AgentStatus.Active,
        isActive: true,
        isResponding: true,
        isStreaming: false,
      });

    it('keeps the hint when the refetched snapshot still shows the agent responding', async () => {
      const agentId = 'agent-queue-hint-refetch';
      appStore.dispatch(bulkUpsertSessions([queuedSession(agentId)]));
      appStore.dispatch(setProcessQueueHint(agentId, 3, 3, 'slots'));
      expect(selectAgentSession.select(appStore.state, agentId)?.processQueueHint).toEqual(HINT);

      // The agent:updated-driven `agent.get` response: an unrelated field
      // changed (name), no processQueueHint key — the wire never carries one.
      agentsApi.get.mockResolvedValueOnce({
        ...queuedSession(agentId),
        name: 'renamed by agent:updated',
      } as never);
      await refreshAgentSessionAfterEvent(agentId);

      expect(agentsApi.get).toHaveBeenCalledWith(agentId, WS);
      const stored = selectAgentSession.select(appStore.state, agentId);
      expect(stored?.name).toBe('renamed by agent:updated');
      expect(stored?.processQueueHint).toEqual(HINT);
    });

    it('drops the hint when the refetched snapshot shows the agent streaming', async () => {
      const agentId = 'agent-queue-hint-refetch-streaming';
      appStore.dispatch(bulkUpsertSessions([queuedSession(agentId)]));
      appStore.dispatch(setProcessQueueHint(agentId, 3, 3, 'slots'));

      agentsApi.get.mockResolvedValueOnce({
        ...queuedSession(agentId),
        isStreaming: true,
        isProcessing: true,
      } as never);
      await refreshAgentSessionAfterEvent(agentId);

      expect(selectAgentSession.select(appStore.state, agentId)?.processQueueHint).toBeUndefined();
    });

    it('does not resurrect the hint from a stale read that lands after agent:process:resumed', async () => {
      const agentId = 'agent-queue-hint-stale-read';
      appStore.dispatch(bulkUpsertSessions([queuedSession(agentId)]));
      appStore.dispatch(setProcessQueueHint(agentId, 3, 3, 'slots'));

      // A refetch starts while the agent is still queued and stays in flight…
      let resolveStale!: (session: AgentSession) => void;
      agentsApi.get.mockImplementationOnce(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveStale = resolve;
          }) as never,
      );
      const stale = refreshAgentSessionAfterEvent(agentId);
      expect(agentsApi.get).toHaveBeenCalledTimes(1);

      // …the live agent:process:resumed clears the hint (bridge → reducer)…
      appStore.dispatch(clearProcessQueueHint(agentId));
      expect(selectAgentSession.select(appStore.state, agentId)?.processQueueHint).toBeUndefined();

      // …and the stale snapshot (taken while queued, still "responding") lands.
      resolveStale({ ...queuedSession(agentId), name: 'stale snapshot' });
      await stale;

      const stored = selectAgentSession.select(appStore.state, agentId);
      expect(stored?.name).toBe('stale snapshot');
      expect(stored?.processQueueHint).toBeUndefined();
    });

    it('keeps a waiting processQueueHint AND the sticky liveTurnOpen across a refetch lacking both keys', async () => {
      // FE_OWNED_FIELD_POLICY drives the carry-forward for every FE-owned
      // field, so the two fields that each once needed their own hand-written
      // block (intent-hq/intent#1815, cloudlands-fe#2443) must survive together.
      const agentId = 'agent-fe-owned-refetch';
      appStore.dispatch(bulkUpsertSessions([queuedSession(agentId)]));
      appStore.dispatch(setProcessQueueHint(agentId, 3, 3, 'slots'));
      appStore.dispatch(
        updateSession(agentId, {
          liveTurnOpen: true,
          liveTurnOpenedAt: '2026-01-02T00:00:00.000Z',
        }),
      );
      const seeded = selectAgentSession.select(appStore.state, agentId);
      expect(seeded?.processQueueHint).toEqual(HINT);
      expect(seeded?.liveTurnOpen).toBe(true);

      agentsApi.get.mockResolvedValueOnce({
        ...queuedSession(agentId),
        name: 'renamed by agent:updated',
      } as never);
      await refreshAgentSessionAfterEvent(agentId);

      const stored = selectAgentSession.select(appStore.state, agentId);
      expect(stored?.name).toBe('renamed by agent:updated');
      expect(stored?.processQueueHint).toEqual(HINT);
      expect(stored?.liveTurnOpen).toBe(true);
      expect(stored?.liveTurnOpenedAt).toBe('2026-01-02T00:00:00.000Z');
    });
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

it('keeps concurrent reads of an opaque agent id separate by workspace', async () => {
  appStore.init();
  const resolve: Array<(session: AgentSession) => void> = [];
  agentsApi.get.mockImplementation(() => new Promise((r) => resolve.push(r)));
  const a = readAgentSession('shared-id', 'workspace-a');
  const b = readAgentSession('shared-id', 'workspace-b');
  expect(agentsApi.get).toHaveBeenCalledWith('shared-id', 'workspace-a');
  expect(agentsApi.get).toHaveBeenCalledWith('shared-id', 'workspace-b');
  resolve[1](makeSession({ id: 'shared-id', workspaceId: 'workspace-b' } as Partial<AgentSession>));
  resolve[0](makeSession({ id: 'shared-id', workspaceId: 'workspace-a' } as Partial<AgentSession>));
  expect((await a)?.workspaceId).toBe('workspace-a');
  expect((await b)?.workspaceId).toBe('workspace-b');
});

it('drops a prior connection response and its scheduled trailing read', async () => {
  appStore.init();
  const agentId = 'connection-agent';
  let finish!: (session: AgentSession) => void;
  agentsApi.get.mockReset();
  agentsApi.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const oldRead = readAgentSession(agentId, 'workspace-a');
  const trailing = refreshAgentSessionAfterEvent(agentId, 'workspace-a');
  for (const callback of reconnectCallbacks) callback();
  agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId, name: 'new connection' }));
  const fresh = await readAgentSession(agentId, 'workspace-a');
  finish(makeSession({ id: agentId, name: 'old connection' }));
  expect(await oldRead).toBeNull();
  await trailing;
  expect(fresh?.name).toBe('new connection');
  expect(agentsApi.get).toHaveBeenCalledTimes(2);
  expect(agentsApi.get).toHaveBeenLastCalledWith(agentId, 'workspace-a');
});

describe('workspace result ownership', () => {
  beforeAll(() => appStore.init());
  it.each(['a-first', 'b-first'])(
    'keeps the latest workspace metadata with %s completion',
    async (order) => {
      const id = `metadata-${order}`;
      const finishes: Array<(session: AgentSession) => void> = [];
      agentsApi.get.mockImplementation(() => new Promise((resolve) => finishes.push(resolve)));
      const a = ensureAgentSession(id, 'workspace-a');
      const b = ensureAgentSession(id, 'workspace-b');
      const finishA = async () => {
        finishes[0](makeSession({ id, workspaceId: 'workspace-a', name: 'A' }));
        await a;
      };
      const finishB = async () => {
        finishes[1](makeSession({ id, workspaceId: 'workspace-b', name: 'B' }));
        await b;
        appStore.dispatch(
          bulkUpsertSessions([
            makeSession({
              id,
              workspaceId: 'workspace-b',
              messages: [{ id: 'b-message', role: 'user', timestamp: '2026-09-28T00:00:00Z' }],
            }),
          ]),
        );
      };
      if (order === 'a-first') {
        await finishA();
        await finishB();
      } else {
        await finishB();
        await finishA();
      }
      const stored = selectAgentSession.select(appStore.state, id);
      expect(stored?.workspaceId).toBe('workspace-b');
      expect(stored?.messages.map((m) => m.id)).toEqual(['b-message']);
    },
  );
});

it('never projects workspace A question markers into a pending workspace B read', async () => {
  appStore.init();
  const id = 'scoped-marker';
  appStore.dispatch(
    bulkUpsertSessions([
      makeSession({
        id,
        workspaceId: 'workspace-a',
        metadata: { pendingQuestionsMessageId: 'a-marker' },
      }),
    ]),
  );
  let finish!: (session: AgentSession) => void;
  agentsApi.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = readAgentSession(id, 'workspace-b');
  notePendingQuestionMarkerProjection(id, 'workspace-a');
  finish(
    makeSession({
      id,
      workspaceId: 'workspace-b',
      metadata: { pendingQuestionsMessageId: 'b-marker' },
    }),
  );
  expect((await read)?.metadata?.pendingQuestionsMessageId).toBe('b-marker');
});

it('preserves a pushed idle transition over an older metadata read without a trailing RPC', async () => {
  appStore.init();
  agentsApi.get.mockClear();
  const agentId = 'pushed-idle-read';
  const busy = makeSession({ id: agentId, isActive: true, isResponding: true });
  appStore.dispatch(bulkUpsertSessions([busy]));
  let finish!: (session: AgentSession) => void;
  agentsApi.get.mockImplementationOnce(
    () =>
      new Promise<AgentSession>((resolve) => {
        finish = resolve;
      }),
  );
  const read = ensureAgentSession(agentId, WS);
  appStore.dispatch(
    updateSession(agentId, { status: AgentStatus.Idle, isActive: false, isResponding: false }),
  );
  finish(busy);
  await read;
  expect(selectAgentSession.select(appStore.state, agentId)).toMatchObject({
    status: AgentStatus.Idle,
    isActive: false,
    isResponding: false,
  });
  expect(agentsApi.get).toHaveBeenCalledTimes(1);
});

it('keeps one-off metadata demand alive through detail hydration in an unmounted workspace', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { installAgentMetadataRecovery } = await import('./agent-metadata-recovery');
  const { setAgents } =
    await import('$store/renderer/slices/workspace-agents/workspace-agents-slice');
  const id = 'unmounted-demand-detail';
  const session = makeSession({ id, workspaceId: 'unmounted-demand', name: 'Fresh detail' });
  appStore.dispatch(setAgents(session.workspaceId, []));
  const scope = rendererEventRecovery.attach({
    supported: false,
    isCurrent: () => true,
    request: vi.fn(),
    fence: vi.fn(),
    onNotification: () => () => {},
    onRetired: () => () => {},
    dispose: () => {},
  });
  const stop = installAgentMetadataRecovery(scope, {
    getState: () => appStore.state,
    dispatch: (action) => appStore.dispatch(action),
    subscribe: () => () => {},
  });
  agentsApi.get.mockResolvedValueOnce(session);
  try {
    await ensureAgentSession(id, session.workspaceId);
    expect(selectAgentSession.select(appStore.state, id)?.name).toBe('Fresh detail');
    expect(appStore.state.agentSessions.detailHydrated?.[id]).toBe(true);
  } finally {
    stop();
    rendererEventRecovery.dispose();
  }
});

it('drops held and queued detail hydration after the recovery session retires', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const id = 'recovery-retired-detail';
  let finish!: (session: AgentSession) => void;
  agentsApi.get.mockReset();
  agentsApi.get.mockImplementationOnce(
    () =>
      new Promise<AgentSession>((resolve) => {
        finish = resolve;
      }),
  );
  const leading = ensureAgentSession(id, WS);
  const trailing = refreshAgentSessionAfterEvent(id, WS);
  rendererEventRecovery.dispose();
  finish(makeSession({ id, name: 'Retired secret' }));
  await Promise.all([leading, trailing]);
  expect(selectAgentSession.select(appStore.state, id)).toBeUndefined();
  expect(agentsApi.get).toHaveBeenCalledTimes(1);
});

it('does not reject a mutation merely because its first queue resource is registered', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { captureAgentMutationOwnership } = await import('./agent-read-ownership');
  const { agentQueueRecoveryKey } = await import('./agent-recovery-keys');
  const scope = rendererEventRecovery.attach({
    supported: false,
    isCurrent: () => true,
    request: vi.fn(),
    fence: vi.fn(),
    onNotification: () => () => {},
    onRetired: () => () => {},
    dispose: () => {},
  });
  const ownership = captureAgentMutationOwnership('first-queue', WS);
  scope.registerResource({
    key: agentQueueRecoveryKey(WS, 'first-queue'),
    workspaceId: WS,
    eventTypes: ['agent:queue:*'],
    isCurrent: () => true,
    read: async () => [],
    apply: () => {},
    invalidate: () => {},
    retire: () => {},
  });
  try {
    expect(ownership.isCurrent(WS)).toBe(true);
  } finally {
    rendererEventRecovery.dispose();
  }
});

it('keeps a valid user mutation after unrelated metadata pushes, but rejects a replaced recovery session', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { agentMetadataRecoveryKey } = await import('./agent-recovery-keys');
  const { captureAgentMutationOwnership } = await import('./agent-read-ownership');
  const scope = rendererEventRecovery.attach({
    supported: false,
    isCurrent: () => true,
    request: vi.fn(),
    fence: vi.fn(),
    onNotification: () => () => {},
    onRetired: () => () => {},
    dispose: () => {},
  });
  scope.registerResource({
    key: agentMetadataRecoveryKey(WS),
    workspaceId: WS,
    eventTypes: ['agent:*'],
    isCurrent: () => true,
    read: async () => [],
    apply: () => {},
    invalidate: () => {},
    retire: () => {},
  });
  const ownership = captureAgentMutationOwnership('valid-send', WS);
  rendererEventRecovery.push(agentMetadataRecoveryKey(WS));
  try {
    expect(ownership.isCurrent(WS)).toBe(true);
  } finally {
    rendererEventRecovery.dispose();
  }
  expect(ownership.isCurrent(WS)).toBe(false);
});

it('does not issue an agent get queued behind hydration after session retirement', async () => {
  const { trackAgentMetadataRead } = await import('./agent-metadata-read-lane');
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const held = Promise.withResolvers<void>();
  const leading = trackAgentMetadataRead(WS, () => held.promise, 'recovery');
  agentsApi.get.mockClear();
  const read = ensureAgentSession('queued-lane-retired', WS);
  expect(agentsApi.get).not.toHaveBeenCalled();
  rendererEventRecovery.dispose();
  held.resolve();
  await Promise.all([leading, read]);
  expect(agentsApi.get).not.toHaveBeenCalled();
  expect(selectAgentSession.select(appStore.state, 'queued-lane-retired')).toBeUndefined();
});

it.each(['__proto__', 'constructor', 'toString'])(
  'preserves explicit set and clear of extension key %s through stale reads',
  async (key) => {
    appStore.init();
    agentsApi.get.mockClear();
    const agentId = `extension-key-${key}`;
    const unrelatedKey = key === '__proto__' ? 'constructor' : '__proto__';
    const value = { resolution: 'applied' as const };
    const seed = makeSession({ id: agentId, metadata: { [key]: value, [unrelatedKey]: 'before' } });
    appStore.dispatch(bulkUpsertSessions([seed]));
    for (const operation of ['set', 'clear'] as const) {
      let finish!: (session: AgentSession) => void;
      agentsApi.get.mockImplementationOnce(
        () =>
          new Promise<AgentSession>((resolve) => {
            finish = resolve;
          }),
      );
      const read = readAgentSession(agentId, WS);
      for (let repeat = 0; repeat < 2; repeat++) {
        appStore.dispatch(
          updateSession(agentId, {
            metadataPatch: {
              [key]: operation === 'set' ? { op: 'set', value } : { op: 'clear' },
            },
          }),
        );
      }
      finish(
        makeSession({
          id: agentId,
          metadata: { [key]: 'stale', [unrelatedKey]: 'fetched', fetched: 'kept' },
        }),
      );
      const resolved = await read;
      expect(resolved).not.toBeNull();
      const metadata = resolved!.metadata!;
      expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
      expect(Object.hasOwn(metadata, key)).toBe(operation === 'set');
      expect(metadata).toEqual({
        ...(operation === 'set' ? { [key]: value } : {}),
        [unrelatedKey]: 'fetched',
        fetched: 'kept',
      });
      expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
      expect(appStore.state.agentSessions.projectionVersions?.[agentId].metadata).toEqual({
        [key]: operation === 'set' ? 2 : 4,
      });
    }
    expect(agentsApi.get.mock.calls).toEqual([
      [agentId, WS],
      [agentId, WS],
    ]);
  },
);

it('confirmation retains the original metadata owner while an older read drains', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { agentMetadataRecoveryKey } = await import('./agent-recovery-keys');
  appStore.init();
  agentsApi.get.mockReset();
  const id = 'confirmation-owner-replacement';
  appStore.dispatch(bulkUpsertSessions([makeSession({ id, name: 'current metadata' })]));
  const scope = rendererEventRecovery.attach({
    supported: false,
    isCurrent: () => true,
    request: vi.fn(),
    onNotification: () => () => {},
    onRetired: () => () => {},
    dispose: () => {},
  } as never);
  const options = {
    key: agentMetadataRecoveryKey(WS),
    workspaceId: WS,
    eventTypes: ['agent:*'],
    isCurrent: () => true,
    read: async () => [],
    apply: () => {},
    invalidate: () => {},
    retire: () => {},
  };
  const owner = scope.registerResource(options);
  const old = Promise.withResolvers<AgentSession>();
  agentsApi.get.mockReturnValueOnce(old.promise).mockResolvedValue(makeSession({ id }));
  try {
    const leading = readAgentSession(id, WS);
    const confirmation = readAgentSessionAfterCurrent(id, WS, () => true);
    owner.dispose();
    scope.registerResource(options);
    old.resolve(makeSession({ id, name: 'old owner' }));
    await leading;
    expect(await confirmation).toBeNull();
    expect(agentsApi.get).toHaveBeenCalledTimes(1);
    expect(selectAgentSession.select(appStore.state, id)?.name).toBe('current metadata');
  } finally {
    rendererEventRecovery.dispose();
    agentsApi.get.mockReset();
  }
});

it.each(['before', 'after', 'after principal change'] as const)(
  'confirmation started %s timeout waits for the actual wire completion',
  async (timing) => {
    const { BackendError } = await import('$lib/client/live/backend-transport-types');
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    rendererEventRecovery.dispose();
    appStore.init();
    agentsApi.get.mockReset();
    const id = `confirmation-physical-timeout-${timing}`;
    const completion = Promise.withResolvers<{ errors: unknown[]; retired: boolean }>();
    const old = Promise.withResolvers<AgentSession>();
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'deadline' }, completion.promise);
    agentsApi.get.mockReturnValueOnce(old.promise).mockResolvedValue(makeSession({ id }));
    const leading = readAgentSession(id, WS).catch(() => null);
    let confirmation =
      timing === 'before' ? readAgentSessionAfterCurrent(id, WS, () => true) : undefined;
    try {
      old.reject(timeout);
      await leading;
      if (timing === 'after principal change') {
        const { principalIdentityChanged } =
          await import('$store/renderer/slices/principal/principal-slice');
        appStore.dispatch(principalIdentityChanged(appStore.state.principal.boundPrincipalId!));
      }
      confirmation ??= readAgentSessionAfterCurrent(id, WS, () => true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(agentsApi.get).toHaveBeenCalledTimes(1);
      completion.resolve({ errors: [], retired: false });
      expect((await confirmation)?.id).toBe(id);
      expect(agentsApi.get).toHaveBeenCalledTimes(2);
    } finally {
      completion.resolve({ errors: [], retired: false });
      await confirmation;
      agentsApi.get.mockReset();
    }
  },
);

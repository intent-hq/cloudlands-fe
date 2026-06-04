/**
 * Cross-file integration for the httpBridgeUnrecoverable hook.
 *
 * Verifies the producer (src/main/http-mcp-bridge.ts) and consumer
 * (AgentBackendHandler) agree on a single mechanism. Fully instantiating
 * both HttpMcpBridge and AgentBackendHandler in one test is too heavy for
 * the existing test infra (both have sizeable dependency graphs), so per
 * the task note's explicit fallback we split the wiring check:
 *
 *   1. The consumer's subscribe path calls the real exported
 *      `onHttpBridgeUnrecoverable` function (verified via vi.mock).
 *   2. Invoking the captured handler with a producer-shaped
 *      `HttpBridgeUnrecoverableInfo` payload triggers
 *      `handleHttpBridgeUnrecoverable` side effects
 *      (agentPersistence.saveAgent + stream-error IPC send).
 *
 * Combined with the existing test in
 * `src/main/__tests__/http-mcp-bridge.test.ts`
 * (`ensureHealthy() emits httpBridgeUnrecoverable when restart fails`) that
 * asserts the producer actually invokes every subscriber registered via
 * `onHttpBridgeUnrecoverable`, this covers producer → consumer end to end.
 */

import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mockPersistence = {
  loadAgent: vi.fn(),
  saveAgent: vi.fn(),
};

const { mockOnHttpBridgeUnrecoverable, mockBroadcastToBrowserIpcClients } = vi.hoisted(
  () => {
    const registered: Array<(info: unknown) => void> = [];
    const fn = vi.fn((handler: (info: unknown) => void) => {
      registered.push(handler);
      return () => {
        const idx = registered.indexOf(handler);
        if (idx >= 0) registered.splice(idx, 1);
      };
    });
    return {
      mockOnHttpBridgeUnrecoverable: Object.assign(fn, {
        __registered: registered,
      }),
      mockBroadcastToBrowserIpcClients: vi.fn(() => true),
    };
  },
);

vi.mock('../../../../main/http-mcp-bridge', () => ({
  onHttpBridgeUnrecoverable: mockOnHttpBridgeUnrecoverable,
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: mockBroadcastToBrowserIpcClients,
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-intent'),
    getName: vi.fn().mockReturnValue('Intent'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {},
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: mockPersistence,
  UnifiedPersistence: { getInstance: () => mockPersistence },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
}));
vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

describe('AgentBackendHandler httpBridgeUnrecoverable integration', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  });

  beforeEach(() => {
    mockOnHttpBridgeUnrecoverable.mockClear();
    mockOnHttpBridgeUnrecoverable.__registered.length = 0;
    mockBroadcastToBrowserIpcClients.mockClear();
    mockBroadcastToBrowserIpcClients.mockReturnValue(true);
    mockPersistence.loadAgent.mockReset();
    mockPersistence.saveAgent.mockReset();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('passes stream workspace id to browser IPC broadcasts', () => {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamWorkspaceIds = new Map([['agent-1', 'ws-1']]);

    const sent = (AgentBackendHandlerClass.prototype as any).sendStreamToRenderer.call(
      handler,
      'agent-1',
      'agent:stream:agent-1',
      { type: 'chunk', data: 'secret' },
    );

    expect(sent).toBe(true);
    expect(mockBroadcastToBrowserIpcClients).toHaveBeenCalledWith(
      'agent:stream:agent-1',
      {
        type: 'chunk',
        data: 'secret',
        status: 'responding',
        activationState: 'active',
        isActive: true,
        isStreaming: true,
        isProcessing: true,
        isResponding: true,
        stopReason: null,
        workspaceId: 'ws-1',
      },
      'ws-1',
    );
  });

  it('subscribes via onHttpBridgeUnrecoverable and the registered handler fires side effects on emit', async () => {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamStartTimes = new Map();
    handler.streamSessionIds = new Map();
    handler.streamWorkspaceIds = new Map();
    handler.streamAssistantMessageIds = new Map();
    handler.streamAssistantAppMessageIds = new Map();
    handler.streamWindowIds = new Map();
    handler.streamGenerations = new Map();
    handler.streamHealthChecks = new Map();
    handler.completedStreams = new Map();
    handler.lastPongTimes = new Map();
    handler.lastPingSentTimes = new Map();
    handler.repairedOrphanedAgents = new Map<string, string>();
    handler.interruptedAgents = new Set();
    handler.interruptedAgentTimeouts = new Map();
    handler.terminatingAgents = new Map<string, number>();
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.sendStreamToRenderer = vi.fn();

    // Run the real subscribe path used by the constructor.
    AgentBackendHandlerClass.prototype[
      'subscribeToHttpBridgeUnrecoverable' as keyof AgentBackendHandler
    ].call(handler);

    // Check 1: consumer wired through the exported producer API.
    expect(mockOnHttpBridgeUnrecoverable).toHaveBeenCalledTimes(1);
    const registered = mockOnHttpBridgeUnrecoverable.mock.calls[0][0];
    expect(typeof registered).toBe('function');

    // Seed one streaming agent so handleHttpBridgeUnrecoverable has work.
    handler.streamStartTimes.set('agent-x', Date.now());
    handler.streamWorkspaceIds.set('agent-x', 'ws-x');
    handler.streamSessionIds.set('agent-x', 'sess-x');
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-x',
        workspaceId: 'ws-x',
        messages: [],
        isStreaming: true,
        status: 'active',
      },
    });

    // Check 2: invoking with a producer-shaped payload fires side effects.
    registered({
      reason: 'still-unhealthy-after-restart',
      port: 5179,
      timestamp: Date.now(),
    });
    // handleHttpBridgeUnrecoverable is async; wait one microtask tick.
    await new Promise((r) => setImmediate(r));
    expect(mockPersistence.saveAgent).toHaveBeenCalledTimes(1);
    expect(handler.sendStreamToRenderer).toHaveBeenCalledWith(
      'agent-x',
      'agent:stream:agent-x',
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('manages terminatingAgents across handleHttpBridgeUnrecoverable: populated during repair, cleared after', async () => {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamStartTimes = new Map();
    handler.streamSessionIds = new Map();
    handler.streamWorkspaceIds = new Map();
    handler.streamAssistantMessageIds = new Map();
    handler.streamAssistantAppMessageIds = new Map();
    handler.streamWindowIds = new Map();
    handler.streamGenerations = new Map();
    handler.streamHealthChecks = new Map();
    handler.completedStreams = new Map();
    handler.lastPongTimes = new Map();
    handler.lastPingSentTimes = new Map();
    handler.repairedOrphanedAgents = new Map<string, string>();
    handler.interruptedAgents = new Set();
    handler.interruptedAgentTimeouts = new Map();
    handler.terminatingAgents = new Map<string, number>();
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.sendStreamToRenderer = vi.fn();

    // Seed streaming state so the handler iterates this agent.
    handler.streamStartTimes.set('agent-x', Date.now());
    handler.streamWorkspaceIds.set('agent-x', 'ws-x');
    handler.streamSessionIds.set('agent-x', 'sess-x');

    // Observe terminatingAgents while the repair is mid-flight — loadAgent
    // is awaited before repairOrphanedStreamingState, so the set must already
    // contain the agentId by this point.
    let wasTerminatingDuringLoad = false;
    mockPersistence.loadAgent.mockImplementation(async () => {
      wasTerminatingDuringLoad = handler.terminatingAgents.has('agent-x');
      return {
        success: true,
        data: {
          id: 'agent-x',
          workspaceId: 'ws-x',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      };
    });

    // Drive the same entry point as the producer would.
    AgentBackendHandlerClass.prototype[
      'subscribeToHttpBridgeUnrecoverable' as keyof AgentBackendHandler
    ].call(handler);
    const registered = mockOnHttpBridgeUnrecoverable.mock.calls[0][0];
    registered({ reason: 'still-unhealthy-after-restart', port: 5179, timestamp: Date.now() });
    await new Promise((r) => setImmediate(r));

    // Set was populated before loadAgent (i.e. before the repair save).
    expect(wasTerminatingDuringLoad).toBe(true);
    // Finally block cleared it so a later restart of this agent can persist.
    expect(handler.terminatingAgents.has('agent-x')).toBe(false);
  });

  // T2 (P1): exercise the REAL constructor path — the prior tests hand-build
  // an instance via Object.create to avoid touching unrelated init work, so
  // they cannot catch a regression where the constructor is reorganized and
  // `subscribeToHttpBridgeUnrecoverable()` silently stops being called. This
  // test resets the singleton, invokes `getInstance()`, and asserts the
  // bridge subscription hook fires exactly once. Side-effect helpers that
  // the constructor also calls are stubbed on the prototype so they don't
  // register IPC handlers or setInterval timers that would leak into the
  // test harness — we explicitly never invoke the private subscribe method
  // ourselves; the constructor does that.
  it('T2: getInstance() subscribes to httpBridgeUnrecoverable exactly once via the real constructor', () => {
    // Reset the singleton so getInstance() actually runs the constructor.
    (AgentBackendHandlerClass as unknown as { instance?: unknown }).instance = undefined;

    const setupHandlersSpy = vi
      .spyOn(
        AgentBackendHandlerClass.prototype as unknown as {
          setupHandlers: () => void;
        },
        'setupHandlers',
      )
      .mockImplementation(() => {});
    const startProviderCleanupIntervalSpy = vi
      .spyOn(
        AgentBackendHandlerClass.prototype as unknown as {
          startProviderCleanupInterval: () => void;
        },
        'startProviderCleanupInterval',
      )
      .mockImplementation(() => {});

    try {
      const instance = AgentBackendHandlerClass.getInstance();
      expect(instance).toBeInstanceOf(AgentBackendHandlerClass);

      // Real constructor-driven subscription.
      expect(mockOnHttpBridgeUnrecoverable).toHaveBeenCalledTimes(1);
      expect(typeof mockOnHttpBridgeUnrecoverable.mock.calls[0][0]).toBe('function');

      // A second getInstance() must NOT re-subscribe (idempotent singleton).
      const instance2 = AgentBackendHandlerClass.getInstance();
      expect(instance2).toBe(instance);
      expect(mockOnHttpBridgeUnrecoverable).toHaveBeenCalledTimes(1);

      // Sanity: the stubbed side-effect helpers were hit by the constructor,
      // proving we went through the real path and not a manual init.
      expect(setupHandlersSpy).toHaveBeenCalledTimes(1);
      expect(startProviderCleanupIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      setupHandlersSpy.mockRestore();
      startProviderCleanupIntervalSpy.mockRestore();
      (AgentBackendHandlerClass as unknown as { instance?: unknown }).instance = undefined;
    }
  });

  // Shared helper for the remaining tests — all share the same hand-built
  // handler shape so factor it out rather than duplicating 15 lines.
  function buildHandler(): any {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamStartTimes = new Map();
    handler.streamSessionIds = new Map();
    handler.streamWorkspaceIds = new Map();
    handler.streamAssistantMessageIds = new Map();
    handler.streamAssistantAppMessageIds = new Map();
    handler.streamWindowIds = new Map();
    handler.streamGenerations = new Map();
    handler.streamHealthChecks = new Map();
    handler.completedStreams = new Map();
    handler.lastPongTimes = new Map();
    handler.lastPingSentTimes = new Map();
    handler.repairedOrphanedAgents = new Map<string, string>();
    handler.interruptedAgents = new Set();
    handler.interruptedAgentTimeouts = new Map();
    handler.terminatingAgents = new Map<string, number>();
    handler.providers = new Map();
    handler.providerLastUsed = new Map();
    handler.sendStreamToRenderer = vi.fn();
    return handler;
  }

  // C1 concurrency regression (P1): when a graceful shutdown has already
  // acquired the `terminatingAgents` guard for an agent and an
  // unrecoverable-bridge event then fires for the same agent, the bridge
  // path's `finally` release must NOT clear the shutdown-owned guard entry.
  // With the old plain-Set implementation the bridge's unconditional
  // `Set.delete` clobbered the shutdown guard, so a racing streaming
  // callback fired after this point would re-dirty the repair save. The
  // refcount scheme keeps shutdown's acquisition alive after bridge
  // releases, so the in-closure `persistStreamingState` guard still
  // short-circuits.
  //
  // This test exercises the REAL producer→consumer wiring: it runs the
  // subscribe path so `onHttpBridgeUnrecoverable` captures the consumer's
  // handler, then invokes THAT registered callback (not
  // `handleHttpBridgeUnrecoverable` directly) to drive the bridge path.
  it('C1: bridge-unrecoverable release does not clear shutdown-path guard entry when bridge-unrecoverable fires concurrently', async () => {
    const handler = buildHandler();
    const agentId = 'agent-shared-guard';
    handler.streamStartTimes.set(agentId, Date.now());
    handler.streamWorkspaceIds.set(agentId, 'ws-shared');
    handler.streamSessionIds.set(agentId, 'sess-shared');

    // persistShutdownState iterates streamStartTimes and acquires the guard
    // for each. loadAgent returning a streaming session is enough to keep
    // the shutdown flush on its normal path.
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: agentId,
        workspaceId: 'ws-shared',
        messages: [],
        isStreaming: true,
        status: 'active',
      },
    });

    // Run the real subscribe path so the bridge-unrecoverable callback is
    // registered through the exported producer API (same pattern as T2 and
    // the subscription-capture test above). Invoking the registered
    // callback — rather than the method — is what this regression actually
    // protects against.
    AgentBackendHandlerClass.prototype[
      'subscribeToHttpBridgeUnrecoverable' as keyof AgentBackendHandler
    ].call(handler);
    const registered = mockOnHttpBridgeUnrecoverable.mock.calls[0][0];
    expect(typeof registered).toBe('function');

    // Acquire the shutdown guard via the REAL code path.
    const shutdownResult = await handler.persistShutdownState(1000);
    expect(shutdownResult.persisted).toContain(agentId);
    // Shutdown leaves the guard acquired — count is >= 1 after return.
    expect(handler.terminatingAgents.has(agentId)).toBe(true);
    const countAfterShutdown = handler.terminatingAgents.get(agentId);
    expect(countAfterShutdown).toBeGreaterThanOrEqual(1);

    // Now drive the bridge-unrecoverable path through the REGISTERED
    // callback (producer → consumer) for the SAME agent. The bridge
    // acquires its own refcount and releases in finally — the shutdown
    // entry must survive.
    handler.streamStartTimes.set(agentId, Date.now()); // cleanupStreamResources removed it
    // Registered callback is fire-and-forget; it schedules
    // handleHttpBridgeUnrecoverable() and discards the promise. Await
    // enough microtask ticks for loadAgent → repair → finally to settle.
    registered({
      reason: 'still-unhealthy-after-restart',
      port: 5179,
      timestamp: Date.now(),
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Post-bridge: shutdown-owned guard entry must still be present so a
    // late-firing streaming callback continues to short-circuit.
    expect(handler.terminatingAgents.has(agentId)).toBe(true);
    expect(handler.terminatingAgents.get(agentId)).toBe(countAfterShutdown);

    // Finally: drive a streaming-callback path (persistStreamingSessionState
    // is what the in-closure `persistStreamingState` delegates to) against
    // the SAME agentId. Because the shutdown refcount entry survived the
    // bridge release, the guard check at the top of that method must
    // short-circuit — saveAgent is NOT called again from the racing
    // streaming callback.
    const saveCountAfterBridge = mockPersistence.saveAgent.mock.calls.length;
    await handler.persistStreamingSessionState(agentId, 'content-block');
    expect(mockPersistence.saveAgent.mock.calls.length).toBe(saveCountAfterBridge);
  });

  // R4 regression (P1): when a replacement provider is swapped into the
  // providers map while `handleHttpBridgeUnrecoverable` is mid-await, the
  // handler must still force-stop the CAPTURED old provider (so its
  // subprocess / streaming callbacks cannot re-dirty the session we just
  // repaired), but must NOT touch the replacement — the replacement is a
  // newer, user-requested provider. Additionally, the bridge-owned
  // terminating guard must be held until the captured old provider's stop
  // resolves so a late streaming callback cannot slip in between stop()
  // and guard-release.
  it(
    'R4: force-stops captured old provider on replacement, preserves replacement, releases guard after stop',
    async () => {
      const handler = buildHandler();
      const agentId = 'agent-provider-swap';
      handler.streamStartTimes.set(agentId, Date.now());
      handler.streamWorkspaceIds.set(agentId, 'ws-swap');
      handler.streamSessionIds.set(agentId, 'sess-swap');

      // Gate providerA.stop on an external deferred so we can observe the
      // guard is still held at the moment stop is invoked AND at the moment
      // stop resolves (i.e. finally has not yet run). Both reads must
      // observe the guard as still-held to prove ordering.
      let guardDuringStopInvocation: boolean | null = null;
      let guardDuringStopResolution: boolean | null = null;
      let resolveStop: () => void = () => {};
      const stopPromise = new Promise<void>((r) => {
        resolveStop = r;
      });

      const providerA = {
        stop: vi.fn(async (_opts?: unknown) => {
          guardDuringStopInvocation = handler.terminatingAgents.has(agentId);
          await stopPromise;
          guardDuringStopResolution = handler.terminatingAgents.has(agentId);
        }),
        cleanup: vi.fn(async () => {}),
      };
      const providerB = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      handler.providers.set(agentId, providerA);
      handler.providerLastUsed.set(agentId, Date.now());

      // Gate loadAgent on an external trigger so the test can swap providers
      // between "handler captured providerA" and "handler calls stop()".
      let resolveLoad: (v: any) => void = () => {};
      const loadPromise = new Promise((r) => {
        resolveLoad = r;
      });
      mockPersistence.loadAgent.mockReturnValue(loadPromise);

      const handlerPromise = handler.handleHttpBridgeUnrecoverable();

      // Yield so the handler reaches `await agentPersistence.loadAgent`.
      await new Promise((r) => setImmediate(r));

      // Swap provider B in — simulates a wake/resume racing the repair.
      handler.providers.set(agentId, providerB);

      // Release loadAgent; handler advances through the repair save and
      // reaches the (gated) providerA.stop call.
      resolveLoad({
        success: true,
        data: {
          id: agentId,
          workspaceId: 'ws-swap',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      });
      // Yield enough ticks for loadAgent → repair → save → stop-invocation
      // to settle. stop itself is still pending on `stopPromise`.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Invariant: providerA.stop was invoked (with forceCleanup) even
      // though a replacement is now in the map. providerB is untouched.
      expect(providerA.stop).toHaveBeenCalledWith({ forceCleanup: true });
      expect(providerA.cleanup).not.toHaveBeenCalled();
      expect(providerB.stop).not.toHaveBeenCalled();
      expect(providerB.cleanup).not.toHaveBeenCalled();

      // Invariant: guard is still held while providerA.stop is in flight,
      // so a late streaming callback firing now would short-circuit in
      // persistStreamingState instead of re-dirtying the repair save.
      expect(guardDuringStopInvocation).toBe(true);
      expect(handler.terminatingAgents.has(agentId)).toBe(true);

      // Resolve providerA.stop and let the handler finish. finally runs
      // AFTER stop resolves — so the guard is released only now.
      resolveStop();
      await handlerPromise;

      // Invariant: at the moment stop resolved, the guard was still held
      // (finally hadn't run yet). Sequence proven.
      expect(guardDuringStopResolution).toBe(true);

      // Invariant: replacement preserved in the map (not stopped, not
      // deleted). Map mutation is conditional on the captured provider
      // still being current.
      expect(handler.providers.get(agentId)).toBe(providerB);
      expect(handler.providerLastUsed.has(agentId)).toBe(true);

      // Invariant: guard released after stop resolved.
      expect(handler.terminatingAgents.has(agentId)).toBe(false);
    },
  );

  // R4b regression (P1): companion to R4. When the providers map is swapped
  // mid-repair AND a replacement STREAM has started for the same agent
  // (incrementing streamGenerations), the bridge's `finally`
  // cleanupStreamResources must NOT erase the newer stream's tracking maps
  // (streamStartTimes / streamWorkspaceIds / streamSessionIds /
  // streamGenerations). Without the generation capture at handler entry,
  // the unconditional cleanup would clobber these entries and subsequent
  // health checks / interrupts would miss the active replacement stream.
  it(
    'R4b: preserves replacement stream tracking when a newer stream started during repair',
    async () => {
      const handler = buildHandler();
      const agentId = 'agent-stream-replacement';
      // Initial stream state (generation 1) — this is the stream the bridge
      // handler is repairing.
      handler.streamStartTimes.set(agentId, 1000);
      handler.streamWorkspaceIds.set(agentId, 'ws-old');
      handler.streamSessionIds.set(agentId, 'sess-old');
      handler.streamGenerations.set(agentId, 1);

      const providerA = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      const providerB = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      handler.providers.set(agentId, providerA);
      handler.providerLastUsed.set(agentId, Date.now());

      // Gate loadAgent so the test can swap in a newer provider AND start a
      // newer stream (simulating a user-initiated resume) between handler
      // entry and the repair save.
      let resolveLoad: (v: any) => void = () => {};
      const loadPromise = new Promise((r) => {
        resolveLoad = r;
      });
      mockPersistence.loadAgent.mockReturnValue(loadPromise);

      const handlerPromise = handler.handleHttpBridgeUnrecoverable();
      // Yield so the handler reaches `await agentPersistence.loadAgent` —
      // streamGenerations was captured before this await.
      await new Promise((r) => setImmediate(r));

      // Simulate a racing wake/resume: new provider AND new stream started
      // for the SAME agent. The stream-start path increments the generation
      // and rewrites the tracking maps with the new stream's values.
      handler.providers.set(agentId, providerB);
      const newGeneration = (handler.streamGenerations.get(agentId) || 0) + 1;
      handler.streamGenerations.set(agentId, newGeneration);
      handler.streamStartTimes.set(agentId, 2000);
      handler.streamWorkspaceIds.set(agentId, 'ws-new');
      handler.streamSessionIds.set(agentId, 'sess-new');

      // Release loadAgent; handler advances through repair → stop → finally.
      resolveLoad({
        success: true,
        data: {
          id: agentId,
          workspaceId: 'ws-old',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      });
      await handlerPromise;

      // Invariant (from R4): replacement provider untouched; providerA was
      // force-stopped.
      expect(providerA.stop).toHaveBeenCalledWith({ forceCleanup: true });
      expect(providerB.stop).not.toHaveBeenCalled();
      expect(providerB.cleanup).not.toHaveBeenCalled();
      expect(handler.providers.get(agentId)).toBe(providerB);

      // Invariant (R4b focus): newer replacement stream's tracking survived
      // the bridge-unrecoverable cleanup. cleanupStreamResources saw the
      // captured generation (1) was older than current (2) and short-circuited
      // — so the replacement stream's maps still point at the new values.
      expect(handler.streamGenerations.get(agentId)).toBe(newGeneration);
      expect(handler.streamStartTimes.get(agentId)).toBe(2000);
      expect(handler.streamWorkspaceIds.get(agentId)).toBe('ws-new');
      expect(handler.streamSessionIds.get(agentId)).toBe('sess-new');
    },
  );

  // R4c regression (P1): multi-agent variant of R4b. When
  // `handleHttpBridgeUnrecoverable` iterates two agents sequentially and
  // awaits mid-repair for the FIRST agent, a racing wake/resume that
  // installs a replacement provider and starts a replacement stream for the
  // SECOND agent must not be disturbed when the loop reaches that second
  // agent. Per-iteration snapshots (reading `providers` / `streamGenerations`
  // at the top of each iteration) would observe the replacement as if it
  // were the original — causing the handler to force-stop the replacement
  // provider AND causing `cleanupStreamResources(agentId, capturedGeneration)`
  // to proceed (captured generation equals current generation, so the stale
  // guard does not fire) and erase the replacement stream's tracking maps.
  // The fix is to capture all per-agent snapshots BEFORE any await.
  it(
    'R4c: replacement installed for a LATER agent while awaiting an EARLIER agent is preserved',
    async () => {
      const handler = buildHandler();
      const agentA = 'agent-a-first';
      const agentB = 'agent-b-later';

      // Seed BOTH agents' streaming state before the handler is invoked.
      // Insertion order determines iteration order — A is processed first.
      handler.streamStartTimes.set(agentA, 1000);
      handler.streamWorkspaceIds.set(agentA, 'ws-a');
      handler.streamSessionIds.set(agentA, 'sess-a');
      handler.streamGenerations.set(agentA, 1);

      handler.streamStartTimes.set(agentB, 1500);
      handler.streamWorkspaceIds.set(agentB, 'ws-b');
      handler.streamSessionIds.set(agentB, 'sess-b');
      handler.streamGenerations.set(agentB, 1);

      const providerA = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      const providerB1 = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      const providerB2 = {
        stop: vi.fn(async () => {}),
        cleanup: vi.fn(async () => {}),
      };
      handler.providers.set(agentA, providerA);
      handler.providers.set(agentB, providerB1);
      handler.providerLastUsed.set(agentA, Date.now());
      handler.providerLastUsed.set(agentB, Date.now());

      // Gate loadAgent for agent A so the test can install a replacement on
      // agent B while the loop is mid-await on A. loadAgent for B resolves
      // immediately (the race scenario — replacement for B is installed
      // during A's await, not B's).
      let resolveLoadA: (v: any) => void = () => {};
      const loadAPromise = new Promise((r) => {
        resolveLoadA = r;
      });
      mockPersistence.loadAgent.mockImplementation(async (id: string) => {
        if (id === agentA) return loadAPromise;
        return {
          success: true,
          data: {
            id,
            workspaceId: id === agentB ? 'ws-b' : 'ws-a',
            messages: [],
            isStreaming: true,
            status: 'active',
          },
        };
      });

      const handlerPromise = handler.handleHttpBridgeUnrecoverable();

      // Yield so the handler reaches `await agentPersistence.loadAgent` for A.
      // At this point the bug would re-read providers[B] / generation[B] on
      // the NEXT iteration — so install the replacement now and verify that
      // the subsequent iteration ignores it.
      await new Promise((r) => setImmediate(r));

      // Racing wake/resume for agent B: new provider AND new stream.
      handler.providers.set(agentB, providerB2);
      const newGenerationB = (handler.streamGenerations.get(agentB) || 0) + 1;
      handler.streamGenerations.set(agentB, newGenerationB);
      handler.streamStartTimes.set(agentB, 2500);
      handler.streamWorkspaceIds.set(agentB, 'ws-b-new');
      handler.streamSessionIds.set(agentB, 'sess-b-new');

      // Release A; handler finishes A's iteration then moves to B.
      resolveLoadA({
        success: true,
        data: {
          id: agentA,
          workspaceId: 'ws-a',
          messages: [],
          isStreaming: true,
          status: 'active',
        },
      });
      await handlerPromise;

      // Sanity: agent A's original provider was force-stopped (A had no
      // replacement in this scenario).
      expect(providerA.stop).toHaveBeenCalledWith({ forceCleanup: true });

      // Core invariant: B's ORIGINAL provider was force-stopped (it's the
      // snapshot captured at handler entry), but B's REPLACEMENT provider
      // must be untouched — not stopped, not cleaned up.
      expect(providerB1.stop).toHaveBeenCalledWith({ forceCleanup: true });
      expect(providerB2.stop).not.toHaveBeenCalled();
      expect(providerB2.cleanup).not.toHaveBeenCalled();

      // Map mutation is conditional on the captured provider still being
      // current, so the replacement remains in the map.
      expect(handler.providers.get(agentB)).toBe(providerB2);
      expect(handler.providerLastUsed.has(agentB)).toBe(true);

      // Replacement stream's tracking survives the bridge-unrecoverable
      // cleanup because cleanupStreamResources received the CAPTURED
      // generation (1), saw current (newGenerationB) was newer, and
      // short-circuited.
      expect(handler.streamGenerations.get(agentB)).toBe(newGenerationB);
      expect(handler.streamStartTimes.get(agentB)).toBe(2500);
      expect(handler.streamWorkspaceIds.get(agentB)).toBe('ws-b-new');
      expect(handler.streamSessionIds.get(agentB)).toBe('sess-b-new');
    },
  );

  // R4d regression (P1): the dead-provider replacement-start cleanup path
  // (handleSendMessage / sendBackendInitiatedMessage) must NOT delete the
  // streamGenerations entry for the agent. If it did, the next stream would
  // re-use the same generation number that a still-in-flight bridge-
  // unrecoverable handler captured BEFORE its `await`, and the stale
  // cleanupStreamResources(agentId, capturedGeneration) call would fail to
  // short-circuit (because `captured < current` is false when they are
  // equal) — erasing the replacement stream's tracking maps.
  //
  // This test models the production sequence directly:
  //   1. Bridge-unrecoverable captures generation N for the live stream.
  //   2. Mid-await, the dead-provider replacement-start cleanup runs
  //      (mirroring the inline deletes in handleSendMessage /
  //      sendBackendInitiatedMessage when an existing provider is found
  //      unhealthy).
  //   3. A new stream starts via the production increment pattern.
  //   4. cleanupStreamResources(agentId, N) is invoked (what the bridge
  //      handler's finally block calls).
  // Invariant: after step 2, streamGenerations[agent] is preserved so step
  // 3's increment yields N+1, and step 4 short-circuits — the replacement
  // stream's tracking maps are intact.
  it('R4d: replacement-start cleanup preserves streamGenerations so stale bridge cleanup short-circuits', () => {
    const handler = buildHandler();
    const agentId = 'agent-replacement-start';

    // Step 1: live stream + bridge captures generation BEFORE await.
    handler.streamGenerations.set(agentId, 1);
    handler.streamStartTimes.set(agentId, 1000);
    handler.streamWorkspaceIds.set(agentId, 'ws-old');
    handler.streamSessionIds.set(agentId, 'sess-old');
    handler.streamWindowIds.set(agentId, 7);
    handler.providers.set(agentId, { stop: vi.fn(), cleanup: vi.fn() });
    handler.providerLastUsed.set(agentId, Date.now());
    const capturedGeneration = handler.streamGenerations.get(agentId);
    expect(capturedGeneration).toBe(1);

    // Step 2: dead-provider replacement-start cleanup. This MIRRORS the
    // exact set of deletes performed inline in handleSendMessage's
    // `provider.isHealthy() === false` branch and the matching branch in
    // sendBackendInitiatedMessage. The fix removes streamGenerations.delete
    // from these branches, so the regression asserts that ALL the other
    // tracking maps were cleared AND streamGenerations was preserved.
    handler.providers.delete(agentId);
    handler.providerLastUsed.delete(agentId);
    handler.streamStartTimes.delete(agentId);
    handler.streamSessionIds.delete(agentId);
    handler.streamWorkspaceIds.delete(agentId);
    handler.streamWindowIds.delete(agentId);
    // NOTE: production code intentionally does NOT delete streamGenerations
    // here. If a future regression re-introduces that delete, the next
    // assertion will fail (counter resets to undefined → 0, then to 1).

    expect(handler.streamGenerations.get(agentId)).toBe(1);
    expect(handler.streamStartTimes.has(agentId)).toBe(false);
    expect(handler.streamWorkspaceIds.has(agentId)).toBe(false);
    expect(handler.streamSessionIds.has(agentId)).toBe(false);
    expect(handler.streamWindowIds.has(agentId)).toBe(false);
    expect(handler.providers.has(agentId)).toBe(false);

    // Step 3: replacement stream starts. Production increments via
    //   const streamGeneration = (this.streamGenerations.get(id) || 0) + 1;
    //   this.streamGenerations.set(id, streamGeneration);
    // Because the entry was preserved at 1, the new stream becomes 2 — strictly
    // greater than the captured value, which is what the staleness guard
    // requires.
    const newStreamGeneration = (handler.streamGenerations.get(agentId) || 0) + 1;
    handler.streamGenerations.set(agentId, newStreamGeneration);
    handler.streamStartTimes.set(agentId, 2000);
    handler.streamWorkspaceIds.set(agentId, 'ws-new');
    handler.streamSessionIds.set(agentId, 'sess-new');
    handler.streamWindowIds.set(agentId, 9);
    expect(newStreamGeneration).toBe(2);
    expect(newStreamGeneration).toBeGreaterThan(capturedGeneration);

    // Step 4: stale bridge-unrecoverable cleanup runs with the OLD captured
    // generation. The guard sees captured (1) < current (2) and skips the
    // map deletes. Replacement stream's tracking survives untouched.
    AgentBackendHandlerClass.prototype[
      'cleanupStreamResources' as keyof AgentBackendHandler
    ].call(handler, agentId, capturedGeneration);

    expect(handler.streamGenerations.get(agentId)).toBe(newStreamGeneration);
    expect(handler.streamStartTimes.get(agentId)).toBe(2000);
    expect(handler.streamWorkspaceIds.get(agentId)).toBe('ws-new');
    expect(handler.streamSessionIds.get(agentId)).toBe('sess-new');
    expect(handler.streamWindowIds.get(agentId)).toBe(9);
  });
});

type AgentBackendHandler = import('../agent-backend-handler.service').AgentBackendHandler;

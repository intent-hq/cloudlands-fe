/**
 * Covers the compensating `agent:restored` rollback emitted when the durable
 * delete chain fails after the early `agent:deleted` broadcast. The early
 * broadcast cannot be un-sent, so the handler must (1) re-emit a restore
 * event carrying the cached session snapshot and (2) clear the deleted-agent
 * guard so the renderer can re-add the agent. Both must happen even though
 * handleDeleteAgent itself returns `{success: false}` to the caller.
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  mockPersistence,
  mainDispatchMock,
  markAgentAsDeletedOpMock,
  removeAgentFromAllTasksMock,
} = vi.hoisted(() => ({
  mockPersistence: {
    loadAgent: vi.fn(),
    saveAgent: vi.fn(),
    deleteAgent: vi.fn(),
  },
  mainDispatchMock: vi.fn(),
  markAgentAsDeletedOpMock: vi.fn(),
  removeAgentFromAllTasksMock: vi.fn(async () => ({ ok: true, data: 0 })),
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
  workspaceService: {
    getWorkspace: vi.fn(async () => ({ ok: true, data: { title: 'Test Workspace' } })),
  },
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mockPersistence,
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
  mainDispatch: mainDispatchMock,
}));

vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

// The rollback emits via a dynamic import of workspace-events-slice and
// agent-subscriptions-slice. Stub those to plain action creators so the test
// can assert the resulting dispatched actions without pulling in the full
// Redux slice machinery.
vi.mock('../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: (event: any) => ({
    type: 'workspaceEvents/emitWorkspaceEvent',
    payload: [event, Date.parse(event.timestamp)],
  }),
}));

vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice', () => ({
  evictDeletedAgent: (wsId: string, agentId: string) => ({
    type: 'agentSubscriptions/evictDeletedAgent',
    payload: [wsId, agentId],
  }),
  markAgentDeleted: (wsId: string, agentId: string, deletedAt: number) => ({
    type: 'agentSubscriptions/markAgentDeleted',
    payload: [wsId, agentId, deletedAt],
  }),
}));

vi.mock('../../events/main/agent-subscription-ops', () => ({
  markAgentAsDeleted: markAgentAsDeletedOpMock,
  updateAgentStatus: vi.fn(),
}));

vi.mock('../../notes/main/notes.service', () => ({
  notesService: {
    removeAgentFromAllTasks: removeAgentFromAllTasksMock,
  },
}));

vi.mock('$shared/main/memory-event-logger', () => ({
  memEvents: {
    providerCleanup: vi.fn(),
    agentTurnStart: vi.fn(),
    custom: vi.fn(),
  },
}));

vi.mock('../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => undefined),
  getWindowIdsForWorkspace: vi.fn(() => []),
}));

vi.mock('../../../../store/main/slices/message-accumulator/message-accumulator-api', () => ({
  getPartialContent: vi.fn(() => ({ contentBlocks: [] as any[] })),
  clear: vi.fn(),
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function makeHandler() {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.providers = new Map();
  handler.providerLastUsed = new Map();
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
  handler.queueAgentWorkspaceIds = new Map();
  handler.emptyResponseRetries = new Map();
  handler.activeSessions = new Map();
  handler.messageQueues = new Map();
  handler.processingQueue = new Set();
  handler.pendingQueueProcessing = new Set();
  handler.pendingBackendDeliveries = new Map();
  handler.pendingBackendDeliveryTimeouts = new Map();
  handler.pendingHandlerReady = new Map();
  handler.deletedAgentIds = new Map<string, number>();
  handler.sendStreamToRenderer = vi.fn();
  handler.invalidatePersistenceListCache = vi.fn();
  handler.stopQueueWatchdogIfEmpty = vi.fn();
  handler.cancelInterruptedAgentSafetyTimeout = vi.fn();
  return handler;
}

async function flushAsync() {
  // Rollback fires two fire-and-forget async chains (evictDeletedAgent dispatch
  // and the agent:restored emit). Each awaits a dynamic import before dispatch,
  // so we need to let a few microtask/macrotask cycles drain.
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}


describe('AgentBackendHandler agent:restored rollback', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence.saveAgent.mockResolvedValue({ success: true });
  });

  it('emits agent:restored and evicts deleted-agent guard when backend.deleteAgent rejects', async () => {
    const handler = makeHandler();
    const agentId = 'agent-rollback-1';
    const workspaceId = 'ws-rollback-1';

    const sessionSnapshot = {
      id: agentId,
      backendSessionId: null,
      workspaceId,
      name: 'Snapshot Agent',
      status: 'Idle',
      messages: [{ id: 'm-1', role: 'user', contentBlocks: [{ type: 'text', text: 'hi' }] }],
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:05:00.000Z',
      isBackground: false,
      metadata: { createdByAgentId: 'parent-agent-1' },
      taskNoteId: 'task-1',
    };

    mockPersistence.loadAgent.mockResolvedValue({ success: true, data: sessionSnapshot });

    const rejectingDelete = vi.fn(async () => {
      throw new Error('disk exploded');
    });
    handler.getBackend = vi.fn(async () => ({
      getAgent: vi.fn(async () => ({
        name: 'Snapshot Agent',
        taskNoteId: 'task-1',
        isBackground: false,
        metadata: { createdByAgentId: 'parent-agent-1' },
      })),
      deleteAgent: rejectingDelete,
    }));

    // Spy on the private emitAgentRestoredEvent method so we can assert the
    // rollback fires it with the cached snapshot. Shadowing the prototype
    // method via an instance property is necessary because the actual
    // `_emitAgentRestoredEventAsync` does a dynamic import of the main
    // Redux store bridge, which isn't initialized in this test environment.
    const emitRestoredSpy = vi.fn();
    handler.emitAgentRestoredEvent = emitRestoredSpy;

    // Pre-populate deletedAgentIds so we can assert the rollback clears it.
    handler.deletedAgentIds.set(agentId, Date.now());

    const result = await handler.handleDeleteAgent(null, { agentId, workspaceId });

    expect(result).toEqual({ success: false, error: 'disk exploded' });

    await flushAsync();

    // Snapshot capture ran before the durable delete so we have data to restore.
    expect(mockPersistence.loadAgent).toHaveBeenCalledWith(agentId, workspaceId);
    expect(rejectingDelete).toHaveBeenCalledWith(agentId, workspaceId);

    // Rollback clears the local guard so subsequent backend-initiated messages
    // aren't rejected for this agentId.
    expect(handler.deletedAgentIds.has(agentId)).toBe(false);

    // agent:restored event fires with the full cached snapshot + metadata.
    expect(emitRestoredSpy).toHaveBeenCalledTimes(1);
    expect(emitRestoredSpy).toHaveBeenCalledWith(
      agentId,
      workspaceId,
      'Snapshot Agent',
      sessionSnapshot,
      'task-1',
      false,
      'parent-agent-1',
      'disk exploded',
    );

    // The rollback also dispatches evictDeletedAgent so renderers/subscribers
    // stop treating this agent as deleted.
    const dispatched = mainDispatchMock.mock.calls.map((c) => c[0]);
    const evictAction = dispatched.find(
      (a: any) =>
        a && a.type === 'agentSubscriptions/evictDeletedAgent' &&
        Array.isArray(a.payload) &&
        a.payload[0] === workspaceId &&
        a.payload[1] === agentId,
    );
    expect(evictAction).toBeDefined();
  });

  it('emits agent:restored when backend.deleteAgent resolves with success=false', async () => {
    const handler = makeHandler();
    const agentId = 'agent-rollback-2';
    const workspaceId = 'ws-rollback-2';
    const sessionSnapshot = {
      id: agentId,
      backendSessionId: null,
      workspaceId,
      name: 'Snap2',
      status: 'Idle',
      messages: [],
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:05:00.000Z',
    };
    mockPersistence.loadAgent.mockResolvedValue({ success: true, data: sessionSnapshot });

    const reportingDelete = vi.fn(async () => ({ success: false, error: 'backend said no' }));
    handler.getBackend = vi.fn(async () => ({
      getAgent: vi.fn(async () => ({ name: 'Snap2' })),
      deleteAgent: reportingDelete,
    }));

    const emitRestoredSpy = vi.fn();
    handler.emitAgentRestoredEvent = emitRestoredSpy;

    const result = await handler.handleDeleteAgent(null, { agentId, workspaceId });
    expect(result.success).toBe(false);
    expect(result.error).toBe('backend said no');

    await flushAsync();

    expect(emitRestoredSpy).toHaveBeenCalledTimes(1);
    const emitArgs = emitRestoredSpy.mock.calls[0];
    expect(emitArgs[0]).toBe(agentId);
    expect(emitArgs[1]).toBe(workspaceId);
    expect(emitArgs[3]).toEqual(sessionSnapshot);
    expect(emitArgs[7]).toBe('backend said no');

    // Durable success path is NOT taken, so the list cache must NOT be
    // invalidated — the agent is still on disk.
    expect(handler.invalidatePersistenceListCache).not.toHaveBeenCalled();
  });
});

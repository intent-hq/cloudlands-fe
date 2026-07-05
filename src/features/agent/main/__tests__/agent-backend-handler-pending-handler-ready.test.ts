import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

const mockPersistence = { loadAgent: vi.fn(), saveAgent: vi.fn() };
vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mockPersistence,
}));
vi.mock('../../../workspace/main/workspace.service', () => ({ workspaceService: {} }));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;
let ipcMainMock: { on: ReturnType<typeof vi.fn> };

function makeHandler() {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.pendingHandlerReady = new Map();
  handler.handlerReadyGeneration = 0;
  handler.streamStartTimes = new Map();
  handler.lastPongTimes = new Map();
  return handler;
}

function captureHandlerReadyCallback(handler: any): (event: any, data: { agentId: string }) => void {
  handler.setupHandlers();
  const call = ipcMainMock.on.mock.calls.find((c: any[]) => c[0] === 'agent:handler-ready');
  return call![1];
}

describe('AgentBackendHandler pendingHandlerReady overlapping handshakes', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } = await vi.importActual(
      '../agent-backend-handler.service',
    ));
    ({ ipcMain: ipcMainMock } = (await vi.importMock('electron')) as any);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('resolves BOTH overlapping waiters for the same agent without clobbering', async () => {
    const handler = makeHandler();
    const handlerReady = captureHandlerReadyCallback(handler);
    const agentId = 'agent-overlap';

    let aResolved = false;
    let bResolved = false;
    const a = handler.waitForFrontendHandlerReady(agentId, 5000).then(() => {
      aResolved = true;
    });
    const b = handler.waitForFrontendHandlerReady(agentId, 5000).then(() => {
      bResolved = true;
    });

    expect(handler.pendingHandlerReady.get(agentId).size).toBe(2);

    handlerReady(null, { agentId });
    await a;
    await b;

    expect(aResolved).toBe(true);
    expect(bResolved).toBe(true);
    expect(handler.pendingHandlerReady.has(agentId)).toBe(false);
  });

  it('a timed-out waiter removes only itself and cannot be resolved by a later stray signal', async () => {
    const handler = makeHandler();
    const handlerReady = captureHandlerReadyCallback(handler);
    const agentId = 'agent-stale';

    const timedOut = handler.waitForFrontendHandlerReady(agentId, 5000);
    const assertion = expect(timedOut).rejects.toThrow(/did not respond/);

    vi.advanceTimersByTime(5000);
    await assertion;

    expect(handler.pendingHandlerReady.has(agentId)).toBe(false);

    expect(() => handlerReady(null, { agentId })).not.toThrow();

    let freshResolved = false;
    const fresh = handler.waitForFrontendHandlerReady(agentId, 5000).then(() => {
      freshResolved = true;
    });
    handlerReady(null, { agentId });
    await fresh;
    expect(freshResolved).toBe(true);
  });

  it('a timed-out waiter does not remove a newer overlapping waiter', async () => {
    const handler = makeHandler();
    const handlerReady = captureHandlerReadyCallback(handler);
    const agentId = 'agent-mixed-timeout';

    const shortWaiter = handler.waitForFrontendHandlerReady(agentId, 5000);
    const shortAssertion = expect(shortWaiter).rejects.toThrow(/did not respond/);

    let longResolved = false;
    const longWaiter = handler.waitForFrontendHandlerReady(agentId, 60000).then(() => {
      longResolved = true;
    });

    expect(handler.pendingHandlerReady.get(agentId).size).toBe(2);

    vi.advanceTimersByTime(5000);
    await shortAssertion;

    expect(handler.pendingHandlerReady.get(agentId).size).toBe(1);

    handlerReady(null, { agentId });
    await longWaiter;
    expect(longResolved).toBe(true);
  });
});


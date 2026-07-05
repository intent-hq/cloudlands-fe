import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWindows, mockGetWindowIdsForWorkspace } = vi.hoisted(() => ({
  mockWindows: [] as any[],
  mockGetWindowIdsForWorkspace: vi.fn(),
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
    getAllWindows: vi.fn(() => mockWindows),
    fromWebContents: vi.fn(() => null),
  },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

vi.mock('../../../workspace/main/workspace.service', () => ({
  workspaceService: {},
}));

vi.mock('../agent-persistence', () => ({
  agentPersistence: {},
  UnifiedPersistence: { getInstance: () => ({}) },
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: {},
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: vi.fn(() => ({ agentSubscriptions: { byWorkspaceId: {} } })),
  mainDispatch: vi.fn(),
}));

vi.mock('../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: { select: vi.fn(() => []) },
}));

vi.mock('../../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => undefined),
  getWindowIdsForWorkspace: mockGetWindowIdsForWorkspace,
}));

vi.unmock('$features/agent/main/agent-backend-handler.service');

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

function makeWindow(id: number, destroyed = false) {
  return {
    id,
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
  };
}

function makeHandler() {
  const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
  handler.streamWorkspaceIds = new Map<string, string>();
  handler.streamWindowIds = new Map<string, number>();
  return handler;
}

describe('AgentBackendHandler virtual workspace stream targeting', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } =
      await import('../agent-backend-handler.service'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindows.length = 0;
    mockGetWindowIdsForWorkspace.mockReturnValue([]);
    (global as any).__browserIpcBroadcast = undefined;
  });

  it('falls back to the originating window for virtual workspace streams', () => {
    const handler = makeHandler();
    const agentId = 'agent-chief-origin';
    const otherWindow = makeWindow(1);
    const originWindow = makeWindow(2);
    mockWindows.push(otherWindow, originWindow);
    handler.streamWorkspaceIds.set(agentId, '__chief__');
    handler.streamWindowIds.set(agentId, originWindow.id);

    const sent = (AgentBackendHandlerClass.prototype as any).sendStreamToRenderer.call(
      handler,
      agentId,
      `agent:stream:${agentId}`,
      { type: 'chunk', data: 'hello' },
    );

    expect(sent).toBe(true);
    expect(mockGetWindowIdsForWorkspace).toHaveBeenCalledWith('__chief__');
    expect(originWindow.webContents.send).toHaveBeenCalledWith(
      `agent:stream:${agentId}`,
      expect.objectContaining({ data: 'hello', workspaceId: '__chief__' }),
    );
    expect(otherWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('targets regular workspace streams only to windows for that workspace', () => {
    const handler = makeHandler();
    const agentId = 'agent-workspace-targeted';
    const workspaceWindow = makeWindow(10);
    const otherWorkspaceWindow = makeWindow(20);
    mockWindows.push(workspaceWindow, otherWorkspaceWindow);
    mockGetWindowIdsForWorkspace.mockReturnValue([workspaceWindow.id]);
    handler.streamWorkspaceIds.set(agentId, 'ws-background');

    const sent = (AgentBackendHandlerClass.prototype as any).sendStreamToRenderer.call(
      handler,
      agentId,
      `agent:stream:${agentId}`,
      { type: 'complete', finishReason: 'end_turn' },
    );

    expect(sent).toBe(true);
    expect(mockGetWindowIdsForWorkspace).toHaveBeenCalledWith('ws-background');
    expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
      `agent:stream:${agentId}`,
      expect.objectContaining({ type: 'complete', workspaceId: 'ws-background' }),
    );
    expect(otherWorkspaceWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('broadcasts virtual workspace streams to all alive windows when no originator is registered', () => {
    const handler = makeHandler();
    const agentId = 'agent-chief-broadcast';
    const firstWindow = makeWindow(1);
    const secondWindow = makeWindow(2);
    const destroyedWindow = makeWindow(3, true);
    mockWindows.push(firstWindow, secondWindow, destroyedWindow);
    handler.streamWorkspaceIds.set(agentId, '__chief__');

    const sent = (AgentBackendHandlerClass.prototype as any).sendStreamToRenderer.call(
      handler,
      agentId,
      `agent:stream:${agentId}`,
      { type: 'chunk', data: 'hello everyone' },
    );

    expect(sent).toBe(true);
    expect(firstWindow.webContents.send).toHaveBeenCalledWith(
      `agent:stream:${agentId}`,
      expect.objectContaining({ data: 'hello everyone', workspaceId: '__chief__' }),
    );
    expect(secondWindow.webContents.send).toHaveBeenCalledWith(
      `agent:stream:${agentId}`,
      expect.objectContaining({ data: 'hello everyone', workspaceId: '__chief__' }),
    );
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
  });
});

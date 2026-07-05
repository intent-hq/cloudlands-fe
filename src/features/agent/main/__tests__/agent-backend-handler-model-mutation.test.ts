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

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-augment'),
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
  agentPersistence: {},
  UnifiedPersistence: {
    getInstance: () => mockPersistence,
  },
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mockPersistence,
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

describe('AgentBackendHandler handleSetModel provider guard', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } =
      await vi.importActual('../agent-backend-handler.service'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHandler(agent?: any) {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.unifiedBackend = {
      getAgent: vi.fn().mockResolvedValue(agent),
      saveAgent: vi.fn().mockResolvedValue({ success: true }),
    };
    handler.providers = new Map();
    return handler;
  }

  it('allows provider changes before first prompt for unused in-memory agents', async () => {
    const agent = {
      id: 'agent-1',
      model: 'gpt5.4',
      provider: 'auggie',
      metadata: {},
      messages: [],
      updatedAt: '2026-03-09T00:00:00.000Z',
    };
    const handler = createHandler(agent);

    const result = await handler.handleSetModel(null, {
      agentId: 'agent-1',
      modelId: 'codex:gpt-5-codex',
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ success: true, modelId: 'codex:gpt-5-codex' });
    expect(agent.model).toBe('codex:gpt-5-codex');
    expect(agent.provider).toBe('codex');
    expect(agent.metadata.provider).toBe('codex');
    expect(handler.unifiedBackend.saveAgent).toHaveBeenCalledWith('agent-1');
  });

  it('allows provider changes before first prompt for persisted blank agents even when backendSessionId exists', async () => {
    const handler = createHandler(undefined);
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-2',
        model: 'gpt5.4',
        provider: 'auggie',
        backendSessionId: 'backend-blank-agent',
        metadata: {},
        messages: [],
      },
    });

    const result = await handler.handleSetModel(null, {
      agentId: 'agent-2',
      modelId: 'codex:gpt-5-codex',
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ success: true, modelId: 'codex:gpt-5-codex' });
    expect(mockPersistence.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'codex:gpt-5-codex',
        provider: 'codex',
        metadata: expect.objectContaining({ provider: 'codex' }),
      }),
    );
  });

  it('rejects provider changes after the first prompt has executed', async () => {
    const handler = createHandler({
      id: 'agent-3',
      model: 'gpt5.4',
      provider: 'auggie',
      metadata: {},
      messages: [{ role: 'user', content: 'hello' }],
    });

    const result = await handler.handleSetModel(null, {
      agentId: 'agent-3',
      modelId: 'codex:gpt-5-codex',
      workspaceId: 'ws-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('first prompt');
    expect(handler.unifiedBackend.saveAgent).not.toHaveBeenCalled();
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
  });

  it('allows provider changes when an ACP session exists but no user message has been sent', async () => {
    const handler = createHandler(undefined);
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-4',
        model: 'gpt5.4',
        provider: 'auggie',
        backendSessionId: 'backend-1',
        acpSessionId: 'acp-1',
        metadata: {},
        messages: [],
      },
    });

    const result = await handler.handleSetModel(null, {
      agentId: 'agent-4',
      modelId: 'codex:gpt-5-codex',
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ success: true, modelId: 'codex:gpt-5-codex' });
    expect(mockPersistence.saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'codex:gpt-5-codex',
        provider: 'codex',
        metadata: expect.objectContaining({ provider: 'codex' }),
      }),
    );
  });

  it('rejects provider changes once a persisted user message exists', async () => {
    const handler = createHandler(undefined);
    mockPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-5',
        model: 'gpt5.4',
        provider: 'auggie',
        backendSessionId: 'backend-1',
        acpSessionId: 'acp-1',
        metadata: {},
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    const result = await handler.handleSetModel(null, {
      agentId: 'agent-5',
      modelId: 'codex:gpt-5-codex',
      workspaceId: 'ws-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('first prompt');
    expect(mockPersistence.saveAgent).not.toHaveBeenCalled();
  });
});

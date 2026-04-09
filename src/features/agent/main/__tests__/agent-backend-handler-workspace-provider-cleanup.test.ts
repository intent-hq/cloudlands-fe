import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  agentPersistence: {},
}));

let AgentBackendHandlerClass: typeof import('../agent-backend-handler.service').AgentBackendHandler;

describe('AgentBackendHandler getWorkspaceIdsWithProviders', () => {
  beforeAll(async () => {
    ({ AgentBackendHandler: AgentBackendHandlerClass } =
      await vi.importActual('../agent-backend-handler.service'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHandler() {
    const handler = Object.create(AgentBackendHandlerClass.prototype) as any;
    handler.streamWorkspaceIds = new Map<string, string>();
    handler.providers = new Map<string, unknown>();
    return handler;
  }

  it('returns workspace IDs tracked by active streams', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-1', 'ws-stream-1');
    handler.streamWorkspaceIds.set('agent-2', 'ws-stream-2');

    expect([...handler.getWorkspaceIdsWithProviders()].sort()).toEqual([
      'ws-stream-1',
      'ws-stream-2',
    ]);
  });

  it('includes providers that exist before any stream is tracked', () => {
    const handler = createHandler();
    handler.providers.set('agent-fallback', {
      config: { workspaceId: 'ws-provider-only' },
    });

    expect([...handler.getWorkspaceIdsWithProviders()]).toEqual(['ws-provider-only']);
  });

  it('deduplicates workspace IDs and skips invalid provider config values', () => {
    const handler = createHandler();
    handler.streamWorkspaceIds.set('agent-stream', 'ws-shared');
    handler.providers.set('agent-duplicate', {
      config: { workspaceId: 'ws-shared' },
    });
    handler.providers.set('agent-empty', {
      config: { workspaceId: '' },
    });
    handler.providers.set('agent-non-string', {
      config: { workspaceId: 123 },
    });
    handler.providers.set('agent-missing', {});

    expect([...handler.getWorkspaceIdsWithProviders()]).toEqual(['ws-shared']);
  });
});
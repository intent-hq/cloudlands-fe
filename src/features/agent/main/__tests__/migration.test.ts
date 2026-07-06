/**
 * Migration Integration Tests
 *
 * Comprehensive tests for the unified agent handlers migration.
 * Tests all agent operations to ensure the migration is complete and functional.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { registerAgentHandlers } from '../unified-agent-handlers';
import { getAgentBackendAdapter } from '../agent-backend-adapter';
import { AgentBackendHandler } from '../agent-backend-handler.service';
import type { AgentIpc } from '$shared/ipc/contracts';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';

// Mock util.promisify FIRST before any imports
vi.mock('util', async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  return {
    ...actual,
    default: actual,
    promisify:
      (fn: any) =>
        (...args: any[]) =>
          new Promise((resolve, reject) => {
            const callback = (err: any, result: any) => {
              if (err) reject(err);
              else resolve(result);
            };
            fn(...args, callback);
          }),
  };
});

// Mock child_process
vi.mock('child_process', () => {
  const mockExecFile = vi.fn((cmd: string, args: string[], options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0);
    }
  });

  const mockExec = vi.fn((cmd: string, options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) {
      setTimeout(() => cb(null, '', ''), 0);
    }
  });

  return {
    default: {
      exec: mockExec,
      execFile: mockExecFile,
    },
    exec: mockExec,
    execFile: mockExecFile,
  };
});

// Mock electron
vi.mock('electron', () => {
  const handlers = new Map<string, Function>();
  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => {
        handlers.set(channel, handler);
      }),
      handlers,
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  };
});

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      access: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    },
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
  },
}));

// Mock logger to reduce noise
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor() {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

// Mock workspaceService for persistence operations
const mockWorkspaceService = {
  getWorkspace: vi.fn(),
};

vi.mock('../../workspace/main/workspace.service', () => ({
  workspaceService: mockWorkspaceService,
}));

describe('Agent Migration Integration Tests', () => {
  let mockBackendHandler: any;
  let adapter: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock workspaceService.getWorkspace to return a valid workspace
    mockWorkspaceService.getWorkspace.mockResolvedValue({
      ok: true,
      data: {
        id: 'workspace-123',
        path: '/test/workspace',
        worktreePath: '/test/workspace',
      },
    });

    // Mock AgentBackendHandler instance
    mockBackendHandler = {
      handleCreateAgent: vi.fn(),
      handleGetAgent: vi.fn(),
      handleSendMessage: vi.fn(),
      handleListAgents: vi.fn(),
      handleDeleteAgent: vi.fn(),
      handleStopSession: vi.fn(),
    };

    // Mock getInstance to return our mock
    vi.spyOn(AgentBackendHandler, 'getInstance').mockReturnValue(mockBackendHandler as any);

    // Get adapter instance
    adapter = getAgentBackendAdapter();

    // Register handlers
    registerAgentHandlers(adapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Core CRUD Operations', () => {
    describe('Create Agent', () => {
      it('should successfully create an agent', async () => {
        const mockAgent = {
          id: BrandedIds.AgentId('agent-123'),
          name: 'Test Agent',
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          status: AgentStatus.Active,
          backendSessionId: BrandedIds.SessionId('session-123'),
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockBackendHandler.handleCreateAgent.mockResolvedValue({
          success: true,
          agent: mockAgent,
        });

        const request: AgentIpc.CreateRequest = {
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          workspacePath: '/test/path',
          name: 'Test Agent',
          model: 'gpt-4',
          systemPrompt: 'You are a helpful assistant',
        };

        const response = await adapter.createAgent(request);

        expect(response.agent).toEqual(mockAgent);
        expect(response.sessionId).toBeDefined();
        expect(mockBackendHandler.handleCreateAgent).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            workspaceId: request.workspaceId,
            workspacePath: request.workspacePath,
            name: request.name,
          }),
        );
      });

      it('should handle creation errors', async () => {
        mockBackendHandler.handleCreateAgent.mockResolvedValue({
          success: false,
          error: 'Failed to create agent',
        });

        const request: AgentIpc.CreateRequest = {
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          workspacePath: '/test/path',
          name: 'Test Agent',
        };

        await expect(adapter.createAgent(request)).rejects.toThrow('Failed to create agent');
      });
    });

    describe('Get Agent', () => {
      it('should successfully get an agent', async () => {
        const mockAgent = {
          id: BrandedIds.AgentId('agent-123'),
          name: 'Test Agent',
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          status: AgentStatus.Active,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockBackendHandler.handleGetAgent.mockResolvedValue({
          success: true,
          agent: mockAgent,
        });

        const request: AgentIpc.GetRequest = {
          agentId: BrandedIds.AgentId('agent-123'),
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        };

        const response = await adapter.getAgent(request);

        expect(response.agent).toEqual(mockAgent);
        expect(mockBackendHandler.handleGetAgent).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            agentId: request.agentId,
            workspaceId: request.workspaceId,
          }),
        );
      });

      it('should return null when agent not found', async () => {
        mockBackendHandler.handleGetAgent.mockResolvedValue({
          success: true,
          agent: null,
        });

        const request: AgentIpc.GetRequest = {
          agentId: BrandedIds.AgentId('non-existent'),
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        };

        const response = await adapter.getAgent(request);

        expect(response.agent).toBeNull();
      });
    });

    describe('Send Message', () => {
      it('should successfully send a message', async () => {
        mockBackendHandler.handleSendMessage.mockResolvedValue({
          success: true,
        });

        const request: AgentIpc.SendMessageRequest = {
          agentId: BrandedIds.AgentId('agent-123'),
          content: 'Hello, agent!',
          contextReferences: [],
        };

        const response = await adapter.sendMessage(request);

        expect(response.messageId).toBeDefined();
        expect(response.streamId).toBeDefined();
        expect(mockBackendHandler.handleSendMessage).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            agentId: request.agentId,
            content: request.content,
          }),
        );
      });

      it('should handle message sending errors', async () => {
        mockBackendHandler.handleSendMessage.mockResolvedValue({
          success: false,
          error: 'Failed to send message',
        });

        const request: AgentIpc.SendMessageRequest = {
          agentId: BrandedIds.AgentId('agent-123'),
          content: 'Hello, agent!',
        };

        await expect(adapter.sendMessage(request)).rejects.toThrow('Failed to send message');
      });
    });

    describe('List Agents', () => {
      it('should successfully list agents', async () => {
        const mockAgents = [
          {
            id: BrandedIds.AgentId('agent-1'),
            name: 'Agent 1',
            workspaceId: BrandedIds.WorkspaceId('workspace-123'),
            status: AgentStatus.Active,
          },
          {
            id: BrandedIds.AgentId('agent-2'),
            name: 'Agent 2',
            workspaceId: BrandedIds.WorkspaceId('workspace-123'),
            status: AgentStatus.Inactive,
          },
        ];

        mockBackendHandler.handleListAgents.mockResolvedValue({
          success: true,
          agents: mockAgents,
        });

        const request: AgentIpc.ListRequest = {
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          includeDeleted: false,
        };

        const response = await adapter.listAgents(request);

        expect(response.agents).toEqual(mockAgents);
        expect(mockBackendHandler.handleListAgents).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            workspaceId: request.workspaceId,
            includeDeleted: request.includeDeleted,
          }),
        );
      });

      it('should return empty array when no agents found', async () => {
        mockBackendHandler.handleListAgents.mockResolvedValue({
          success: true,
          agents: [],
        });

        const request: AgentIpc.ListRequest = {
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        };

        const response = await adapter.listAgents(request);

        expect(response.agents).toEqual([]);
      });
    });

    describe('Delete Agent', () => {
      it('should successfully delete an agent', async () => {
        mockBackendHandler.handleDeleteAgent.mockResolvedValue({
          success: true,
        });

        const request: AgentIpc.DeleteRequest = {
          agentId: BrandedIds.AgentId('agent-123'),
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        };

        const response = await adapter.deleteAgent(request);

        expect(response.success).toBe(true);
        expect(mockBackendHandler.handleDeleteAgent).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            agentId: request.agentId,
            workspaceId: request.workspaceId,
          }),
        );
      });

      it('should handle deletion errors', async () => {
        mockBackendHandler.handleDeleteAgent.mockResolvedValue({
          success: false,
          error: 'Agent not found',
        });

        const request: AgentIpc.DeleteRequest = {
          agentId: BrandedIds.AgentId('non-existent'),
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        };

        await expect(adapter.deleteAgent(request)).rejects.toThrow('Agent not found');
      });
    });
  });

  describe('Session Management', () => {
    describe('Stop Session', () => {
      it('should successfully stop a session', async () => {
        mockBackendHandler.handleStopSession.mockResolvedValue({
          success: true,
        });

        const request: AgentIpc.StopRequest = {
          agentId: BrandedIds.AgentId('agent-123'),
        };

        const response = await adapter.stopSession(request);

        expect(response.success).toBe(true);
        expect(mockBackendHandler.handleStopSession).toHaveBeenCalledWith(
          null,
          expect.objectContaining({
            agentId: request.agentId,
          }),
        );
      });

      it('should handle stop session errors', async () => {
        mockBackendHandler.handleStopSession.mockResolvedValue({
          success: false,
          error: 'Session not found',
        });

        const request: AgentIpc.StopRequest = {
          agentId: BrandedIds.AgentId('non-existent'),
        };

        await expect(adapter.stopSession(request)).rejects.toThrow('Session not found');
      });
    });
  });


});

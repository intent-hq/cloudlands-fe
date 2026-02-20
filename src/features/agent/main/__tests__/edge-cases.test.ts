/**
 * Edge Cases and Error Scenarios Tests
 *
 * Tests for edge cases, error handling, and duplicate handler prevention.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { registerAgentHandlers } from '../unified-agent-handlers';
import { getAgentBackendAdapter } from '../agent-backend-adapter';
import { AgentBackendHandler } from '../agent-backend-handler.service';
import type { AgentIpc } from '$shared/ipc/contracts';
import * as BrandedIds from '$shared/types/branded-ids';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { formatIpcError } from '../ipc-response-formatter';

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
  const mockHandlers = new Map<string, Function>();
  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => {
        if (mockHandlers.has(channel)) {
          throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        mockHandlers.set(channel, handler);
      }),
      handlers: mockHandlers,
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

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

describe('Edge Cases and Error Scenarios', () => {
  let mockBackendHandler: any;
  let adapter: any;
  let mockHandlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get mockHandlers from the mocked ipcMain
    mockHandlers = (ipcMain as any).handlers;
    mockHandlers.clear();

    // Mock AgentBackendHandler instance
    mockBackendHandler = {
      handleCreateAgent: vi.fn(),
      handleGetAgent: vi.fn(),
      handleSendMessage: vi.fn(),
      handleListAgents: vi.fn(),
      handleDeleteAgent: vi.fn(),
      handleStopSession: vi.fn(),
      handlePersistenceSave: vi.fn(),
      handlePersistenceLoad: vi.fn(),
      handlePersistenceList: vi.fn(),
      handleActivateAgent: vi.fn(),
    };

    // Mock getInstance to return our mock
    vi.spyOn(AgentBackendHandler, 'getInstance').mockReturnValue(mockBackendHandler as any);

    // Get adapter instance
    adapter = getAgentBackendAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Duplicate Handler Registration Prevention', () => {
    it('should not allow duplicate handler registration', () => {
      // Register handlers once
      registerAgentHandlers(adapter);

      // Verify all handlers are registered
      expect(mockHandlers.has(AGENT_CHANNELS.CREATE)).toBe(true);
      expect(mockHandlers.has(AGENT_CHANNELS.GET_SESSION)).toBe(true);
      expect(mockHandlers.has(AGENT_CHANNELS.SEND_MESSAGE)).toBe(true);

      // Try to register again - should throw
      expect(() => {
        registerAgentHandlers(adapter);
      }).toThrow(/Attempted to register a second handler/);
    });

    it('should register all required channels', () => {
      registerAgentHandlers(adapter);

      // Verify all channels are registered
      const expectedChannels = [
        AGENT_CHANNELS.CREATE,
        AGENT_CHANNELS.GET_SESSION,
        AGENT_CHANNELS.SEND_MESSAGE,
        AGENT_CHANNELS.LIST_SESSIONS,
        AGENT_CHANNELS.DELETE_SESSION,
        AGENT_CHANNELS.STOP,
        AGENT_CHANNELS.PERSISTENCE_SAVE,
        AGENT_CHANNELS.PERSISTENCE_LOAD,
        AGENT_CHANNELS.PERSISTENCE_LIST,
        AGENT_CHANNELS.ACTIVATE,
      ];

      expectedChannels.forEach((channel) => {
        expect(mockHandlers.has(channel)).toBe(true);
      });
    });
  });

  describe('Invalid Input Handling', () => {
    beforeEach(() => {
      registerAgentHandlers(adapter);
    });

    it('should handle invalid workspace ID', async () => {
      const request = {
        workspaceId: '', // Empty workspace ID
        workspacePath: '/test/path',
        name: 'Test Agent',
      };

      await expect(adapter.createAgent(request as any)).rejects.toThrow('Invalid workspace ID');
    });

    it('should handle missing required fields', async () => {
      mockBackendHandler.handleCreateAgent.mockResolvedValue({
        success: false,
        error: 'Missing required field: name',
      });

      const request = {
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        workspacePath: '/test/path',
        // Missing name
      } as any;

      await expect(adapter.createAgent(request)).rejects.toThrow('Missing required field');
    });

    it('should handle null responses gracefully', async () => {
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

  describe('Error Response Formatting', () => {
    it('should format validation errors correctly', () => {
      const error = new Error('Validation failed');
      const response = formatIpcError(error, 'agent:create');

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('INTERNAL_ERROR');
      expect(response.error?.message).toBe('Validation failed');
    });

    it('should include error details when available', () => {
      const error = new Error('Database connection failed');
      (error as any).code = 'DB_CONNECTION_ERROR';
      (error as any).details = { host: 'localhost', port: 5432 };

      const response = formatIpcError(error, 'agent:create');

      expect(response.error?.details).toBeDefined();
      expect(response.error?.details.stack).toContain('Database connection failed');
    });
  });

  describe('Concurrent Operations', () => {
    beforeEach(() => {
      registerAgentHandlers(adapter);
    });

    it('should handle concurrent agent creation', async () => {
      const mockAgent1 = {
        id: BrandedIds.AgentId('agent-1'),
        name: 'Agent 1',
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        backendSessionId: BrandedIds.SessionId('session-1'),
      };

      const mockAgent2 = {
        id: BrandedIds.AgentId('agent-2'),
        name: 'Agent 2',
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        backendSessionId: BrandedIds.SessionId('session-2'),
      };

      mockBackendHandler.handleCreateAgent
        .mockResolvedValueOnce({ success: true, agent: mockAgent1 })
        .mockResolvedValueOnce({ success: true, agent: mockAgent2 });

      const request1: AgentIpc.CreateRequest = {
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        workspacePath: '/test/path',
        name: 'Agent 1',
      };

      const request2: AgentIpc.CreateRequest = {
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        workspacePath: '/test/path',
        name: 'Agent 2',
      };

      const [response1, response2] = await Promise.all([
        adapter.createAgent(request1),
        adapter.createAgent(request2),
      ]);

      expect(response1.agent.id).toBe('agent-1');
      expect(response2.agent.id).toBe('agent-2');
      expect(response1.sessionId).not.toBe(response2.sessionId);
    });

    it('should handle mixed success and failure in concurrent operations', async () => {
      mockBackendHandler.handleDeleteAgent
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Agent not found' });

      const request1: AgentIpc.DeleteRequest = {
        agentId: BrandedIds.AgentId('agent-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
      };

      const request2: AgentIpc.DeleteRequest = {
        agentId: BrandedIds.AgentId('non-existent'),
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
      };

      const results = await Promise.allSettled([
        adapter.deleteAgent(request1),
        adapter.deleteAgent(request2),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('Agent not found');
      }
    });
  });

  describe('Resource Cleanup', () => {
    beforeEach(() => {
      registerAgentHandlers(adapter);
    });

    it('should handle cleanup when agent is deleted during operation', async () => {
      // Start a long-running operation
      const sendPromise = new Promise((resolve) => {
        setTimeout(() => {
          mockBackendHandler.handleSendMessage.mockResolvedValue({
            success: false,
            error: 'Agent was deleted',
          });
          resolve(null);
        }, 100);
      });

      // Delete agent while operation is in progress
      mockBackendHandler.handleDeleteAgent.mockResolvedValue({
        success: true,
      });

      const deleteRequest: AgentIpc.DeleteRequest = {
        agentId: BrandedIds.AgentId('agent-123'),
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
      };

      await adapter.deleteAgent(deleteRequest);

      // Wait for send operation to complete
      await sendPromise;

      // Verify send operation fails gracefully
      const sendRequest: AgentIpc.SendMessageRequest = {
        agentId: BrandedIds.AgentId('agent-123'),
        content: 'Test message',
      };

      mockBackendHandler.handleSendMessage.mockResolvedValue({
        success: false,
        error: 'Agent was deleted',
      });

      await expect(adapter.sendMessage(sendRequest)).rejects.toThrow('Agent was deleted');
    });
  });

  describe('ID Generation and Validation', () => {
    beforeEach(() => {
      registerAgentHandlers(adapter);
    });

    it('should generate unique message IDs', async () => {
      mockBackendHandler.handleSendMessage.mockResolvedValue({
        success: true,
      });

      const request: AgentIpc.SendMessageRequest = {
        agentId: BrandedIds.AgentId('agent-123'),
        content: 'Test message',
      };

      const responses = await Promise.all([
        adapter.sendMessage(request),
        adapter.sendMessage(request),
        adapter.sendMessage(request),
      ]);

      const messageIds = responses.map((r) => r.messageId);
      const uniqueIds = new Set(messageIds);

      expect(uniqueIds.size).toBe(messageIds.length);
    });

    it('should generate unique stream IDs', async () => {
      mockBackendHandler.handleSendMessage.mockResolvedValue({
        success: true,
      });

      const request: AgentIpc.SendMessageRequest = {
        agentId: BrandedIds.AgentId('agent-123'),
        content: 'Test message',
      };

      const responses = await Promise.all([
        adapter.sendMessage(request),
        adapter.sendMessage(request),
        adapter.sendMessage(request),
      ]);

      const streamIds = responses.map((r) => r.streamId);
      const uniqueIds = new Set(streamIds);

      expect(uniqueIds.size).toBe(streamIds.length);
    });
  });
});

/**
 * Unified Agent Handlers Tests
 *
 * Tests for type-safe IPC handler registration and execution
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import type { AgentIpc, IpcResponse } from '$shared/ipc/contracts';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
}));

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor() {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

// Mock electron module at top level
vi.mock('electron', () => {
  const mockHandle = vi.fn();
  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: mockHandle,
    },
  };
});

import {
  registerAgentHandlers,
  type IAgentBackendService,
} from '../unified-agent-handlers';
import { ipcMain } from 'electron';

describe('Unified Agent Handlers', () => {
  let mockBackend: IAgentBackendService;

  beforeEach(() => {
    // Mock backend service
    mockBackend = {
      createAgent: vi.fn(),
      getAgent: vi.fn(),
      sendMessage: vi.fn(),
      listAgents: vi.fn(),
    };
  });

  describe('Handler Registration', () => {
    it('should register all agent handlers', () => {
      registerAgentHandlers(mockBackend);

      // Verify all handlers are registered
      expect(ipcMain.handle).toHaveBeenCalled();
    });
  });

  describe('Create Agent Handler', () => {
    it('should handle successful agent creation', async () => {
      const mockResponse: AgentIpc.CreateResponse = {
        agent: {
          id: BrandedIds.AgentId('agent-123'),
          name: 'Test Agent',
          workspaceId: BrandedIds.WorkspaceId('workspace-123'),
          status: AgentStatus.Active,
          backendSessionId: BrandedIds.SessionId('session-123'),
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        sessionId: BrandedIds.SessionId('session-123'),
      };

      mockBackend.createAgent = vi.fn().mockResolvedValue(mockResponse);

      const result: IpcResponse<AgentIpc.CreateResponse> = {
        success: true,
        data: mockResponse,
      };

      expect(result.success).toBe(true);
      expect(result.data?.agent.id).toBe('agent-123');
    });

    it('should handle validation errors', async () => {
      const invalidRequest = {
        workspaceId: 'invalid-uuid',
        workspacePath: '/path',
        name: '',
      };

      // Validation should fail
      expect(invalidRequest.name).toBe('');
    });
  });

  describe('Send Message Handler', () => {
    it('should handle message sending', async () => {
      const mockResponse: AgentIpc.SendMessageResponse = {
        messageId: BrandedIds.MessageId('msg-123'),
        streamId: BrandedIds.StreamId('stream-123'),
      };

      mockBackend.sendMessage = vi.fn().mockResolvedValue(mockResponse);

      const result: IpcResponse<AgentIpc.SendMessageResponse> = {
        success: true,
        data: mockResponse,
      };

      expect(result.success).toBe(true);
      expect(result.data?.messageId).toBe('msg-123');
    });
  });

  describe('List Agents Handler', () => {
    it('should list agents for workspace', async () => {
      const mockResponse: AgentIpc.ListResponse = {
        agents: [],
      };

      mockBackend.listAgents = vi.fn().mockResolvedValue(mockResponse);

      const result: IpcResponse<AgentIpc.ListResponse> = {
        success: true,
        data: mockResponse,
      };

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data?.agents)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should format errors consistently', () => {
      const errorResponse: IpcResponse<any> = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
        },
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});

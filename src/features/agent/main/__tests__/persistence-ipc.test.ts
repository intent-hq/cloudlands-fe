/**
 * Tests for persistence IPC handlers
 * These tests ensure that IPC handlers correctly call the underlying services
 * with the right parameters and return the expected response format.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupPersistenceIPC } from '../persistence.ipc';
import { UnifiedPersistence } from '../agent-persistence';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { BrandedIds } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types/agent-session';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock the unified persistence
vi.mock('../agent-persistence', () => ({
  UnifiedPersistence: {
    getInstance: vi.fn(),
  },
}));

// Mock the workspace config
vi.mock('$shared/config', () => ({
  WorkspaceConfig: {
    paths: {
      workspace: vi.fn((workspaceId: string) => `/test/workspaces/${workspaceId}`),
    },
  },
}));

describe('Persistence IPC Handlers', () => {
  let mockUnifiedPersistence: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
    handlers = new Map();

    // Mock ipcMain.handle to capture handlers
    (ipcMain.handle as any).mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    });

    // Create mock unified persistence instance
    mockUnifiedPersistence = {
      loadAgent: vi.fn(),
      saveAgent: vi.fn(),
      deleteAgent: vi.fn(),
      listAgents: vi.fn(),
    };

    (UnifiedPersistence.getInstance as any).mockReturnValue(mockUnifiedPersistence);

    // Setup IPC handlers
    setupPersistenceIPC();
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('LOAD_SESSION handler', () => {
    it('should call loadAgent with all three required parameters', async () => {
      const testAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-123'),
        workspaceId: BrandedIds.WorkspaceId('workspace-456'),
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: BrandedIds.MessageId('msg-1'),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: BrandedIds.MessageId('msg-2'),
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Hi there!' }],
            timestamp: new Date().toISOString(),
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Mock successful load
      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: testAgent,
      });

      // Get the handler
      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.LOAD_SESSION);
      expect(handler).toBeDefined();

      // Create mock event
      const mockEvent = {} as IpcMainInvokeEvent;

      // Call the handler
      const result = await handler!(mockEvent, {
        agentId: 'agent-123',
        workspaceId: 'workspace-456',
      });

      // Verify loadAgent was called with all THREE parameters
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-123',
        'workspace-456',
        '/test/workspaces/workspace-456', // The workspacePath parameter that was missing!
      );

      // Verify response format
      expect(result).toEqual({
        success: true,
        data: testAgent,
      });
    });

    it('should return correct format when agent not found', async () => {
      // Mock failed load
      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: false,
        error: 'Agent not found',
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.LOAD_SESSION);
      const mockEvent = {} as IpcMainInvokeEvent;

      const result = await handler!(mockEvent, {
        agentId: 'non-existent',
        workspaceId: 'workspace-456',
      });

      // Verify response format for failure case
      expect(result).toEqual({
        success: true,
        data: null,
      });
    });
  });

  describe('LOAD_AGENT_CONFIG handler', () => {
    it('should call loadAgent with all three required parameters', async () => {
      const testConfig = {
        id: 'agent-789',
        name: 'Config Test Agent',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: testConfig,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.LOAD_AGENT_CONFIG);
      expect(handler).toBeDefined();

      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        agentId: 'agent-789',
        workspaceId: 'workspace-789',
      });

      // Verify all three parameters are passed
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-789',
        'workspace-789',
        '/test/workspaces/workspace-789',
      );

      // Verify response format
      expect(result).toEqual({
        success: true,
        data: testConfig,
      });
    });
  });

  describe('SAVE_SESSION handler', () => {
    it('should handle existing agent update correctly', async () => {
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-existing'),
        workspaceId: BrandedIds.WorkspaceId('workspace-123'),
        name: 'Existing Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const updatedAgent = {
        ...existingAgent,
        messages: [
          {
            id: BrandedIds.MessageId('msg-new'),
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'New message' }],
            timestamp: new Date().toISOString(),
          },
        ],
      };

      // Mock loadAgent to return existing agent
      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      // Mock saveAgent success
      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      expect(handler).toBeDefined();

      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: updatedAgent,
        workspaceId: 'workspace-123',
      });

      // Verify loadAgent was called with all three parameters
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-existing',
        'workspace-123',
        '/test/workspaces/workspace-123',
      );

      // Verify saveAgent was called
      expect(mockUnifiedPersistence.saveAgent).toHaveBeenCalled();

      // Verify response
      expect(result.success).toBe(true);
    });
  });

  describe('Response Format Consistency', () => {
    it('should always return { success, data } format', async () => {
      // Test various scenarios to ensure consistent response format
      const testCases = [
        {
          channel: IPC_CHANNELS.PERSISTENCE.LOAD_SESSION,
          mockReturn: { success: true, data: { id: 'test' } },
          expectedResponse: { success: true, data: { id: 'test' } },
        },
        {
          channel: IPC_CHANNELS.PERSISTENCE.LOAD_SESSION,
          mockReturn: { success: false, error: 'Not found' },
          expectedResponse: { success: true, data: null },
        },
        {
          channel: IPC_CHANNELS.PERSISTENCE.LOAD_AGENT_CONFIG,
          mockReturn: { success: true, data: { config: 'test' } },
          expectedResponse: { success: true, data: { config: 'test' } },
        },
      ];

      for (const testCase of testCases) {
        mockUnifiedPersistence.loadAgent.mockResolvedValue(testCase.mockReturn);

        const handler = handlers.get(testCase.channel);
        const mockEvent = {} as IpcMainInvokeEvent;

        const result = await handler!(mockEvent, {
          agentId: 'test-id',
          workspaceId: 'workspace-test',
        });

        expect(result).toEqual(testCase.expectedResponse);
      }
    });
  });
});

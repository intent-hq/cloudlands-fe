/**
 * Tests for persistence IPC handlers
 * These tests ensure that IPC handlers correctly call the underlying services
 * with the right parameters and return the expected response format.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { setupPersistenceIPC } from '../persistence.ipc';
import { UnifiedPersistence } from '../agent-persistence';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import * as BrandedIds from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types/agent-session';

const mocks = vi.hoisted(() => ({
  unifiedPersistence: {
    loadAgent: vi.fn(),
    saveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    listAgents: vi.fn(),
  },
  workspacePath: vi.fn((workspaceId: string) => `/test/workspaces/${workspaceId}`),
}));

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock the unified persistence
vi.mock('../agent-persistence', () => ({
  unifiedPersistence: mocks.unifiedPersistence,
  UnifiedPersistence: {
    getInstance: vi.fn(() => mocks.unifiedPersistence),
  },
}));

vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: mocks.unifiedPersistence,
}));

// Mock the workspace config
vi.mock('../../../../shared/main/config.js', () => ({
  WorkspaceConfig: {
    paths: {
      workspace: mocks.workspacePath,
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

    mockUnifiedPersistence = mocks.unifiedPersistence;

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
        workspaceId: BrandedIds.WorkspaceId('blue-river'),
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
        workspaceId: 'blue-river',
      });

      // Verify loadAgent was called with all THREE parameters
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-123',
        'blue-river',
        '/test/workspaces/blue-river', // The workspacePath parameter that was missing!
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
        workspaceId: 'blue-river',
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
        workspaceId: 'green-hill',
      });

      // Verify all three parameters are passed
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-789',
        'green-hill',
        '/test/workspaces/green-hill',
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
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
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
        workspaceId: 'amber-forest',
      });

      // Verify loadAgent was called with all three parameters
      expect(mockUnifiedPersistence.loadAgent).toHaveBeenCalledWith(
        'agent-existing',
        'amber-forest',
        '/test/workspaces/amber-forest',
      );

      // Verify saveAgent was called
      expect(mockUnifiedPersistence.saveAgent).toHaveBeenCalled();

      // Verify response
      expect(result.success).toBe(true);
    });

    it('should merge messages when frontend is missing backend-persisted messages', async () => {
      // Simulate: disk has 6 messages (2 original + 4 from subscription delivery)
      // Frontend only has 3 messages (2 original + 1 new user message)
      // The fix should merge: keep all 6 disk messages + append the 1 new user message
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-merge-test'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'Merge Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: '2026-03-05T17:11:21Z' },
          { id: BrandedIds.MessageId('msg-3'), role: 'user', contentBlocks: [{ type: 'text', text: 'Wake' }], timestamp: '2026-03-05T17:15:00Z' },
          { id: BrandedIds.MessageId('msg-4'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Woke' }], timestamp: '2026-03-05T17:18:00Z' },
          { id: BrandedIds.MessageId('msg-5'), role: 'user', contentBlocks: [{ type: 'text', text: 'Wake2' }], timestamp: '2026-03-05T17:20:00Z' },
          { id: BrandedIds.MessageId('msg-6'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Woke2' }], timestamp: '2026-03-05T17:22:00Z' },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Frontend has stale session: only the first 2 messages + 1 new user message
      const frontendSession = {
        ...existingAgent,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: '2026-03-05T17:11:21Z' },
          { id: BrandedIds.MessageId('msg-new'), role: 'user', contentBlocks: [{ type: 'text', text: 'New message' }], timestamp: '2026-03-05T19:21:27Z' },
        ] as any[],
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      expect(handler).toBeDefined();

      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
      });

      expect(result.success).toBe(true);

      // Verify saveAgent was called with merged messages (6 disk + 1 new = 7)
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages).toHaveLength(7);
      // First 6 should be the disk messages
      expect(savedAgent.messages[0].id).toBe(BrandedIds.MessageId('msg-1'));
      expect(savedAgent.messages[5].id).toBe(BrandedIds.MessageId('msg-6'));
      // Last should be the new frontend message
      expect(savedAgent.messages[6].id).toBe(BrandedIds.MessageId('msg-new'));
    });

    it('should merge messages when counts are equal but content differs (race condition)', async () => {
      // Simulate: disk has [user1, assistant1] (backend persisted assistant response)
      // Frontend has [user1, user2] (sent new message before seeing assistant response)
      // The merge should produce [user1, assistant1, user2]
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-equal-count-test'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'Equal Count Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi there' }], timestamp: '2026-03-05T17:11:21Z' },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Frontend has same count (2) but different content - it has a new user message instead of assistant
      const frontendSession = {
        ...existingAgent,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-new'), role: 'user', contentBlocks: [{ type: 'text', text: 'Follow up question' }], timestamp: '2026-03-05T17:15:00Z' },
        ] as any[],
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
      });

      expect(result.success).toBe(true);

      // Verify: merged messages should be [msg-1, msg-2 (assistant from disk), msg-new (new from frontend)]
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages).toHaveLength(3);
      expect(savedAgent.messages[0].id).toBe(BrandedIds.MessageId('msg-1'));
      expect(savedAgent.messages[1].id).toBe(BrandedIds.MessageId('msg-2')); // preserved from disk
      expect(savedAgent.messages[2].id).toBe(BrandedIds.MessageId('msg-new')); // appended from frontend
    });

    it('deduplicates stale frontend placeholder against backend final message with same appMessageId', async () => {
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-app-message-dedup-test'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'App Message Dedup Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('msg-user-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg_backend_final'), appMessageId: 'app-msg-final', role: 'assistant', contentBlocks: [{ type: 'text', text: 'Final answer' }], timestamp: '2026-03-05T17:08:55Z', isStreaming: false },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const frontendSession = {
        ...existingAgent,
        messages: [
          { id: BrandedIds.MessageId('msg-user-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('550e8400-e29b-41d4-a716-446655440001'), appMessageId: 'app-msg-final', role: 'assistant', contentBlocks: [{ type: 'text', text: 'Final answer' }], timestamp: '2026-03-05T17:08:54Z', isStreaming: true },
          { id: BrandedIds.MessageId('msg-new-user'), role: 'user', contentBlocks: [{ type: 'text', text: 'Follow up' }], timestamp: '2026-03-05T17:09:00Z' },
        ] as any[],
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({ success: true, data: existingAgent });
      mockUnifiedPersistence.saveAgent.mockResolvedValue({ success: true });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      const result = await handler!({} as IpcMainInvokeEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
      });

      expect(result.success).toBe(true);
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages.map((message: any) => message.id)).toEqual([
        BrandedIds.MessageId('msg-user-1'),
        BrandedIds.MessageId('msg_backend_final'),
        BrandedIds.MessageId('msg-new-user'),
      ]);
      expect(savedAgent.messages[1].appMessageId).toBe('app-msg-final');
      expect(savedAgent.messages[1].isStreaming).toBe(false);
    });

    it('should NOT merge when frontend has zero overlap with disk messages (unrelated histories)', async () => {
      // Edge case: frontend has entirely new messages with no IDs matching disk.
      // frontendKnownMessages would be empty, isPrefix would vacuously be true,
      // and without the guard this would falsely merge unrelated histories.
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-no-overlap-test'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'No Overlap Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('disk-msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Disk hello' }], timestamp: '2026-03-05T17:00:00Z' },
          { id: BrandedIds.MessageId('disk-msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Disk response' }], timestamp: '2026-03-05T17:01:00Z' },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Frontend has completely different messages — zero ID overlap with disk
      const frontendSession = {
        ...existingAgent,
        messages: [
          { id: BrandedIds.MessageId('fe-msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Frontend hello' }], timestamp: '2026-03-05T18:00:00Z' },
        ] as any[],
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
      });

      expect(result.success).toBe(true);

      // With zero overlap, we should NOT merge — frontend messages are used as-is
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages).toHaveLength(1);
      expect(savedAgent.messages[0].id).toBe(BrandedIds.MessageId('fe-msg-1'));
    });

    it('should NOT merge messages when allowTruncation is true (edit/regenerate)', async () => {
      // Simulate edit/regenerate: disk has 4 messages, frontend has 3 (truncated + new)
      // The allowTruncation flag tells the handler to skip the merge logic
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-edit-test'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'Edit Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: '2026-03-05T17:11:21Z' },
          { id: BrandedIds.MessageId('msg-3'), role: 'user', contentBlocks: [{ type: 'text', text: 'Edit this' }], timestamp: '2026-03-05T17:15:00Z' },
          { id: BrandedIds.MessageId('msg-4'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Old response' }], timestamp: '2026-03-05T17:18:00Z' },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Frontend truncated to first 2 messages and added a new edited message
      const frontendSession = {
        ...existingAgent,
        messages: [
          { id: BrandedIds.MessageId('msg-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-03-05T17:08:49Z' },
          { id: BrandedIds.MessageId('msg-2'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: '2026-03-05T17:11:21Z' },
          { id: BrandedIds.MessageId('msg-new'), role: 'user', contentBlocks: [{ type: 'text', text: 'Edited message' }], timestamp: '2026-03-05T19:21:27Z' },
        ] as any[],
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
        options: { allowTruncation: true },
      });

      expect(result.success).toBe(true);

      // With allowTruncation, the frontend's messages should be used as-is (no merge)
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages).toHaveLength(3); // Frontend's 3 messages, not merged
      expect(savedAgent.messages[0].id).toBe(BrandedIds.MessageId('msg-1'));
      expect(savedAgent.messages[1].id).toBe(BrandedIds.MessageId('msg-2'));
      expect(savedAgent.messages[2].id).toBe(BrandedIds.MessageId('msg-new'));
    });
  });

  describe('Empty messages guard', () => {
    it('should preserve disk messages when frontend sends empty messages array', async () => {
      // Regression test: frontend SAVE_SESSION fires before Redux has the user message,
      // sending messages: []. The guard must keep the disk messages intact.
      const existingAgent: AgentSession = {
        id: BrandedIds.AgentId('agent-empty-guard'),
        workspaceId: BrandedIds.WorkspaceId('amber-forest'),
        name: 'Guard Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: BrandedIds.MessageId('msg-user-1'), role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: '2026-04-14T10:00:00Z' },
          { id: BrandedIds.MessageId('msg-asst-1'), role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi there' }], timestamp: '2026-04-14T10:00:05Z' },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const frontendSession = {
        ...existingAgent,
        messages: [], // Empty — frontend hasn't received messages yet
      };

      mockUnifiedPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      mockUnifiedPersistence.saveAgent.mockResolvedValue({
        success: true,
      });

      const handler = handlers.get(IPC_CHANNELS.PERSISTENCE.SAVE_SESSION);
      const mockEvent = {} as IpcMainInvokeEvent;
      const result = await handler!(mockEvent, {
        session: frontendSession,
        workspaceId: 'amber-forest',
      });

      expect(result.success).toBe(true);

      // The saved agent must retain the disk messages, not the empty frontend array
      const savedAgent = mockUnifiedPersistence.saveAgent.mock.calls[0][0];
      expect(savedAgent.messages).toHaveLength(2);
      expect(savedAgent.messages[0].id).toBe(BrandedIds.MessageId('msg-user-1'));
      expect(savedAgent.messages[1].id).toBe(BrandedIds.MessageId('msg-asst-1'));
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
          workspaceId: 'test-workspace',
        });

        expect(result).toEqual(testCase.expectedResponse);
      }
    });
  });
});

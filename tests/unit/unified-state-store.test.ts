/**
 * Unit Tests for UnifiedStateStore
 *
 * Tests the single source of truth for all application state including
 * agent state, workspace state, context state, model state, and UI state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { unifiedStateStore } from '../../src/features/agent/services/unified-state-store';
import type { ContextItem } from '../../src/features/agent/services/unified-state-store';
import {
  createAgentId,
  createWorkspaceId,
  createMessageId,
} from '../../src/shared/types/branded-ids';
import { AgentStatus } from '../../src/shared/types';
import type { Workspace, AgentSession, AgentMessage } from '../../src/shared/types';

// Mock logger
vi.mock('../../src/shared/logger', () => ({
  Logger: class MockLogger {
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('UnifiedStateStore', () => {
  let store: typeof unifiedStateStore;
  let workspaceId: ReturnType<typeof createWorkspaceId>;
  let agentId: ReturnType<typeof createAgentId>;
  let workspace: Workspace;
  let agentSession: AgentSession;

  beforeEach(() => {
    store = unifiedStateStore;
    store.clear();

    workspaceId = createWorkspaceId(randomUUID());
    agentId = createAgentId(randomUUID());

    workspace = {
      id: workspaceId,
      name: 'Test Workspace',
      path: '/test/workspace',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    agentSession = {
      id: agentId,
      workspaceId,
      status: AgentStatus.Idle,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backendSessionId: agentId,
      name: 'Test Agent',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    store.clear();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = unifiedStateStore;
      const instance2 = unifiedStateStore;
      expect(instance1).toBe(instance2);
    });
  });

  describe('Workspace Operations', () => {
    it('should set a workspace', () => {
      store.setWorkspace(workspace);
      store.setCurrentWorkspace(workspaceId);

      const current = store.currentWorkspace;
      expect(current).toBeDefined();
      expect(current?.workspace.id).toBe(workspaceId);
    });

    it('should handle multiple workspaces', () => {
      const workspace2 = { ...workspace, id: createWorkspaceId(randomUUID()) };

      store.setWorkspace(workspace);
      store.setWorkspace(workspace2);

      store.setCurrentWorkspace(workspace.id);
      expect(store.currentWorkspace?.workspace.id).toBe(workspace.id);

      store.setCurrentWorkspace(workspace2.id);
      expect(store.currentWorkspace?.workspace.id).toBe(workspace2.id);
    });
  });

  describe('Agent Operations', () => {
    beforeEach(() => {
      store.setWorkspace(workspace);
      store.setCurrentWorkspace(workspaceId);
    });

    it('should add an agent to workspace', () => {
      store.setAgent(workspaceId, agentSession);
      store.setActiveAgent(workspaceId, agentId);

      const currentAgent = store.currentAgent;
      expect(currentAgent).toBeDefined();
      expect(currentAgent?.session.id).toBe(agentId);
    });

    it('should get all agents', () => {
      const agent2 = { ...agentSession, id: createAgentId(randomUUID()) };

      store.setAgent(workspaceId, agentSession);
      store.setAgent(workspaceId, agent2);

      const allAgents = store.allAgents;
      expect(allAgents).toHaveLength(2);
      expect(allAgents.map((a) => a.id)).toContain(agentSession.id);
      expect(allAgents.map((a) => a.id)).toContain(agent2.id);
    });
  });

  describe('Message Operations', () => {
    beforeEach(() => {
      store.setWorkspace(workspace);
      store.setCurrentWorkspace(workspaceId);
      store.setAgent(workspaceId, agentSession);
    });

    it('should add messages to agent', () => {
      const message: AgentMessage = {
        id: createMessageId(randomUUID()),
        agentId,
        role: 'user',
        content: 'Test message',
        timestamp: new Date().toISOString(),
      };

      store.addMessage(workspaceId, agentId, message);

      store.setActiveAgent(workspaceId, agentId);
      const currentAgent = store.currentAgent;
      expect(currentAgent?.messages).toHaveLength(1);
      expect(currentAgent?.messages[0].content).toBe('Test message');
    });
  });

  describe('Streaming Operations', () => {
    beforeEach(() => {
      store.setWorkspace(workspace);
      store.setCurrentWorkspace(workspaceId);
      store.setAgent(workspaceId, agentSession);
      store.setActiveAgent(workspaceId, agentId);
    });

    it('should set streaming state', () => {
      store.setStreaming(workspaceId, agentId, true);
      expect(store.currentAgent?.streaming.active).toBe(true);

      store.setStreaming(workspaceId, agentId, false);
      expect(store.currentAgent?.streaming.active).toBe(false);
    });

    it('should update stream buffer', () => {
      store.setStreaming(workspaceId, agentId, true);
      store.updateStreamBuffer(workspaceId, agentId, 'Hello World');

      expect(store.currentAgent?.streaming.buffer).toBe('Hello World');
    });

    it('should clear buffer when streaming ends', () => {
      store.setStreaming(workspaceId, agentId, true);
      store.updateStreamBuffer(workspaceId, agentId, 'Test');
      store.setStreaming(workspaceId, agentId, false);

      expect(store.currentAgent?.streaming.buffer).toBe('');
      expect(store.currentAgent?.streaming.contentBlocks).toEqual([]);
    });
  });

  describe('Context Operations', () => {
    it('should add context items', () => {
      const item: ContextItem = {
        id: 'ctx-1',
        type: 'file',
        label: 'test.ts',
        content: 'file content',
        path: '/test.ts',
      };

      store.addContextItem(item);
      expect(store.contextItems).toHaveLength(1);
      expect(store.contextItems[0]).toEqual(item);
    });

    it('should prevent duplicate context items', () => {
      const item: ContextItem = {
        id: 'ctx-1',
        type: 'file',
        content: 'same content',
      };

      store.addContextItem(item);
      store.addContextItem(item);

      expect(store.contextItems).toHaveLength(1);
    });

    it('should remove context items', () => {
      const item: ContextItem = {
        id: 'ctx-1',
        type: 'file',
        content: 'test',
      };

      store.addContextItem(item);
      expect(store.contextItems).toHaveLength(1);

      store.removeContextItem('ctx-1');
      expect(store.contextItems).toHaveLength(0);
    });

    it('should handle selection context', () => {
      const selection = {
        text: 'selected code',
        file: '/src/test.ts',
        language: 'typescript',
      };

      store.setSelection(selection);

      expect(store.currentSelection).toEqual(selection);
      expect(store.hasSelection).toBe(true);
      expect(store.contextItems.some((i) => i.type === 'selection')).toBe(true);
    });

    it('should clear selection', () => {
      store.setSelection({ text: 'test' });
      expect(store.hasSelection).toBe(true);

      store.setSelection(null);
      expect(store.hasSelection).toBe(false);
      expect(store.currentSelection).toBeNull();
    });

    it('should detect memories and rules', () => {
      store.addContextItem({ id: '1', type: 'memory', content: 'memory' });
      expect(store.hasMemories).toBe(true);
      expect(store.hasRules).toBe(false);

      store.addContextItem({ id: '2', type: 'rule', content: 'rule' });
      expect(store.hasRules).toBe(true);
    });
  });

  describe('Model Operations', () => {
    it('should select model and persist', () => {
      store.selectModel('gpt-4');
      expect(store.selectedModel).toBe('gpt-4');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('workspaces-selected-model', 'gpt-4');
    });

    it('should set available models', () => {
      const models = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'claude', name: 'Claude' },
      ] as any;

      store.setAvailableModels(models);
      expect(store.availableModels).toEqual(models);
      expect(store.isLoadingModels).toBe(false);
    });
  });
});

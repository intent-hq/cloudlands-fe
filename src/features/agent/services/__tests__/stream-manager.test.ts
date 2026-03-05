/**
 * Unified Stream Manager Tests
 *
 * Comprehensive tests for stream management, memory cleanup, and event handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamManager, type StreamConfig } from '../stream-manager';
import type { ContentBlock, AgentSession, SessionId } from '$shared/types';
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId, SessionId as BrandedSessionId } from '$shared/types/branded-ids';

describe('Unified Stream Manager', () => {
  let streamManager: StreamManager;
  const testWorkspaceId = WorkspaceId('00000000-0000-0000-0000-000000000789');

  beforeEach(() => {
    streamManager = StreamManager.getInstance();

    // Create a test workspace
    unifiedStateStore.setWorkspace({
      id: testWorkspaceId,
      name: 'Test Workspace',
      path: '/test/workspace',
      gitBranch: 'main',
      gitRemote: 'origin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
    });
    unifiedStateStore.setCurrentWorkspace(testWorkspaceId);

    // Create test agents in the state
    const testSession: AgentSession = {
      id: AgentId('agent-123'),
      name: 'Test Agent',
      workspaceId: testWorkspaceId,
      backendSessionId: BrandedSessionId('session-123'),
      status: AgentStatus.Idle,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    unifiedStateStore.setAgent(testWorkspaceId, {
      id: testSession.id,
      session: testSession,
      streaming: { active: false, buffer: '', contentBlocks: [] },
      messages: [],
      errors: [],
      ui: {
        isExpanded: false,
        scrollPosition: 0,
        searchQuery: '',
        isAtTop: true,
        isAtBottom: true,
        showScrollToBottom: false,
      },
      metadata: {},
      lastAccess: Date.now(),
    });

    // Create additional test agents for multi-agent tests
    const testSession2: AgentSession = {
      id: AgentId('agent-1'),
      name: 'Test Agent 1',
      workspaceId: testWorkspaceId,
      backendSessionId: BrandedSessionId('session-1'),
      status: AgentStatus.Idle,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    unifiedStateStore.setAgent(testWorkspaceId, {
      id: testSession2.id,
      session: testSession2,
      streaming: { active: false, buffer: '', contentBlocks: [] },
      messages: [],
      errors: [],
      ui: {
        isExpanded: false,
        scrollPosition: 0,
        searchQuery: '',
        isAtTop: true,
        isAtBottom: true,
        showScrollToBottom: false,
      },
      metadata: {},
      lastAccess: Date.now(),
    });

    const testSession3: AgentSession = {
      id: AgentId('agent-2'),
      name: 'Test Agent 2',
      workspaceId: testWorkspaceId,
      backendSessionId: BrandedSessionId('session-2'),
      status: AgentStatus.Idle,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    unifiedStateStore.setAgent(testWorkspaceId, {
      id: testSession3.id,
      session: testSession3,
      streaming: { active: false, buffer: '', contentBlocks: [] },
      messages: [],
      errors: [],
      ui: {
        isExpanded: false,
        scrollPosition: 0,
        searchQuery: '',
        isAtTop: true,
        isAtBottom: true,
        showScrollToBottom: false,
      },
      metadata: {},
      lastAccess: Date.now(),
    });
  });

  afterEach(() => {
    streamManager.destroy();
    // Clear the workspace
    unifiedStateStore.setCurrentWorkspace(null);
  });

  describe('Stream Lifecycle', () => {
    it('should start a new stream and return streamId', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      expect(streamId).toBeDefined();
      expect(typeof streamId).toBe('string');
      expect(streamManager.isActive(streamId)).toBe(true);
    });

    it('should add text chunks to stream', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      streamManager.addTextChunk(streamId, 'Hello ');
      streamManager.addTextChunk(streamId, 'World');

      // Flush batch processor to process chunks immediately
      streamManager.flushBatch();

      const session = streamManager.getSession(streamId);
      expect(session?.accumulatedText).toBe('Hello World');
      expect(session?.chunks.length).toBe(2);
    });

    it('should add content blocks to stream', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      const block: ContentBlock = {
        type: 'text',
        id: 'block-1',
        content: 'Test content',
      };

      streamManager.addContentBlock(streamId, block);

      const session = streamManager.getSession(streamId);
      expect(session?.contentBlocks.length).toBe(1);
      expect(session?.contentBlocks[0]).toEqual(block);
    });

    it('should complete a stream and return result', async () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      streamManager.addTextChunk(streamId, 'Test message');

      const result = await streamManager.completeStream(streamId);

      expect(result.success).toBe(true);
      expect(result.message?.contentBlocks).toBeDefined();
      expect(result.message?.contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Test message',
      });
      expect(result.chunkCount).toBe(1);
      expect(result.duration).toBeDefined();
    });

    it('should handle stream errors', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      const error = new Error('Test error');

      streamManager.handleError(streamId, error);

      const session = streamManager.getSession(streamId);
      expect(session?.isComplete).toBe(true);
      expect(session?.error).toEqual(error);
    });

    it('should cancel a stream', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      const streamId = streamManager.startStream(config);
      streamManager.cancelStream(streamId);

      const session = streamManager.getSession(streamId);
      expect(session?.isComplete).toBe(true);
      expect(session?.error?.message).toBe('Stream cancelled by user');
    });
  });

  describe('Memory Management', () => {
    it('should track active streams', () => {
      const config1: StreamConfig = {
        agentId: 'agent-1',
        sessionId: 'session-1',
        workspaceId: testWorkspaceId,
      };

      const config2: StreamConfig = {
        agentId: 'agent-2',
        sessionId: 'session-2',
        workspaceId: testWorkspaceId,
      };

      const streamId1 = streamManager.startStream(config1);
      const streamId2 = streamManager.startStream(config2);

      const activeStreams = streamManager.getActiveStreams();
      expect(activeStreams.length).toBe(2);
    });
  });

  describe('Event Emission', () => {
    it('should emit stream:start event', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      let eventFired = false;
      streamManager.on('stream:start', ({ streamId, config: cfg }: any) => {
        expect(streamId).toBeDefined();
        expect(cfg).toEqual(config);
        eventFired = true;
      });

      streamManager.startStream(config);
      streamManager.flushBatch(); // Flush any pending async operations
      expect(eventFired).toBe(true);
    });

    it('should emit stream:chunk event', () => {
      const config: StreamConfig = {
        agentId: 'agent-123',
        sessionId: 'session-456',
        workspaceId: testWorkspaceId,
      };

      // startStream now returns agentId as the canonical key
      const agentId = streamManager.startStream(config);
      expect(agentId).toBe('agent-123'); // Verify we get agentId back

      let eventFired = false;
      streamManager.on('stream:chunk', ({ streamId: id, chunk }: any) => {
        // streamId in event is the internal stream ID (for logging), not agentId
        expect(id).toBeDefined();
        expect(chunk.type).toBe('text');
        expect(chunk.data).toBe('Test');
        eventFired = true;
      });

      // Use agentId to add chunks (the canonical key)
      streamManager.addTextChunk(agentId, 'Test');
      streamManager.flushBatch(); // Flush any pending async operations
      expect(eventFired).toBe(true);
    });
  });

  describe('Cross-Workspace Isolation', () => {
    const workspaceAId = WorkspaceId('00000000-0000-0000-0000-00000000000a');
    const workspaceBId = WorkspaceId('00000000-0000-0000-0000-00000000000b');

    beforeEach(() => {
      // Set up two workspaces
      unifiedStateStore.setWorkspace({
        id: workspaceAId,
        name: 'Workspace A',
        path: '/test/workspace-a',
        gitBranch: 'main',
        gitRemote: 'origin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpened: new Date().toISOString(),
      });

      unifiedStateStore.setWorkspace({
        id: workspaceBId,
        name: 'Workspace B',
        path: '/test/workspace-b',
        gitBranch: 'main',
        gitRemote: 'origin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastOpened: new Date().toISOString(),
      });

      // Create agents in each workspace
      const agentSessionA: AgentSession = {
        id: AgentId('agent-ws-a'),
        name: 'Agent in Workspace A',
        workspaceId: workspaceAId,
        backendSessionId: BrandedSessionId('session-ws-a'),
        status: AgentStatus.Idle,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      unifiedStateStore.setAgent(workspaceAId, {
        id: agentSessionA.id,
        session: agentSessionA,
        streaming: { active: false, buffer: '', contentBlocks: [] },
        messages: [],
        errors: [],
        ui: {
          isExpanded: false,
          scrollPosition: 0,
          searchQuery: '',
          isAtTop: true,
          isAtBottom: true,
          showScrollToBottom: false,
        },
        metadata: {},
        lastAccess: Date.now(),
      });

      const agentSessionB: AgentSession = {
        id: AgentId('agent-ws-b'),
        name: 'Agent in Workspace B',
        workspaceId: workspaceBId,
        backendSessionId: BrandedSessionId('session-ws-b'),
        status: AgentStatus.Idle,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      unifiedStateStore.setAgent(workspaceBId, {
        id: agentSessionB.id,
        session: agentSessionB,
        streaming: { active: false, buffer: '', contentBlocks: [] },
        messages: [],
        errors: [],
        ui: {
          isExpanded: false,
          scrollPosition: 0,
          searchQuery: '',
          isAtTop: true,
          isAtBottom: true,
          showScrollToBottom: false,
        },
        metadata: {},
        lastAccess: Date.now(),
      });
    });

    it('should route stream chunks to the correct workspace even after switching currentWorkspace', () => {
      // Start on workspace A
      unifiedStateStore.setCurrentWorkspace(workspaceAId);

      // Start a stream for an agent in workspace A
      const configA: StreamConfig = {
        agentId: 'agent-ws-a',
        sessionId: 'session-ws-a',
        workspaceId: workspaceAId,
      };
      const streamIdA = streamManager.startStream(configA);

      // Verify stream is active
      expect(streamManager.isActive(streamIdA)).toBe(true);

      // Switch current workspace to B
      unifiedStateStore.setCurrentWorkspace(workspaceBId);

      // Send a chunk — it should still go to workspace A's agent state
      streamManager.addTextChunk(streamIdA, 'Hello from A');
      streamManager.flushBatch();

      // Verify the chunk went to workspace A's agent, not B's
      const workspaceA = unifiedStateStore.getWorkspace(workspaceAId);
      const agentA = workspaceA?.agents.get('agent-ws-a' as any);
      expect(agentA?.streaming.buffer).toContain('Hello from A');

      // Verify workspace B's agent was NOT affected
      const workspaceB = unifiedStateStore.getWorkspace(workspaceBId);
      const agentB = workspaceB?.agents.get('agent-ws-b' as any);
      expect(agentB?.streaming.buffer).toBe('');
      expect(agentB?.streaming.active).toBe(false);
    });

    it('should fail fast when workspace does not exist', () => {
      const nonExistentWorkspaceId = WorkspaceId('00000000-0000-0000-0000-ffffffffffff');

      const config: StreamConfig = {
        agentId: 'agent-orphan',
        sessionId: 'session-orphan',
        workspaceId: nonExistentWorkspaceId,
      };

      // startStream should return agentId but clean up the session immediately
      const streamId = streamManager.startStream(config);
      expect(streamId).toBe('agent-orphan');

      // The session should have been cleaned up due to fail-fast
      expect(streamManager.isActive(streamId)).toBe(false);
      expect(streamManager.getSession(streamId)).toBeNull();
    });

    it('should keep streams in different workspaces independent', () => {
      unifiedStateStore.setCurrentWorkspace(workspaceAId);

      // Start streams in both workspaces
      const configA: StreamConfig = {
        agentId: 'agent-ws-a',
        sessionId: 'session-ws-a',
        workspaceId: workspaceAId,
      };
      const configB: StreamConfig = {
        agentId: 'agent-ws-b',
        sessionId: 'session-ws-b',
        workspaceId: workspaceBId,
      };

      const streamIdA = streamManager.startStream(configA);
      const streamIdB = streamManager.startStream(configB);

      // Both should be active
      expect(streamManager.isActive(streamIdA)).toBe(true);
      expect(streamManager.isActive(streamIdB)).toBe(true);

      // Send different chunks to each
      streamManager.addTextChunk(streamIdA, 'Data for A');
      streamManager.addTextChunk(streamIdB, 'Data for B');
      streamManager.flushBatch();

      // Verify each workspace got its own data
      const sessionA = streamManager.getSession(streamIdA);
      const sessionB = streamManager.getSession(streamIdB);
      expect(sessionA?.accumulatedText).toBe('Data for A');
      expect(sessionB?.accumulatedText).toBe('Data for B');

      // Verify state store has correct data per workspace
      const workspaceA = unifiedStateStore.getWorkspace(workspaceAId);
      const workspaceB = unifiedStateStore.getWorkspace(workspaceBId);
      expect(workspaceA?.agents.get('agent-ws-a' as any)?.streaming.buffer).toContain('Data for A');
      expect(workspaceB?.agents.get('agent-ws-b' as any)?.streaming.buffer).toContain('Data for B');

      // Cancel stream A — stream B should be unaffected
      streamManager.cancelStream(streamIdA);
      expect(streamManager.isActive(streamIdA)).toBe(false);
      expect(streamManager.isActive(streamIdB)).toBe(true);
    });

    it('should complete stream on correct workspace after workspace switch', async () => {
      unifiedStateStore.setCurrentWorkspace(workspaceAId);

      const configA: StreamConfig = {
        agentId: 'agent-ws-a',
        sessionId: 'session-ws-a',
        workspaceId: workspaceAId,
      };

      const streamIdA = streamManager.startStream(configA);
      streamManager.addTextChunk(streamIdA, 'Complete me');

      // Switch to workspace B before completing
      unifiedStateStore.setCurrentWorkspace(workspaceBId);

      // Complete should still work correctly for workspace A
      const result = await streamManager.completeStream(streamIdA);
      expect(result.success).toBe(true);
      expect(result.message?.contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Complete me',
      });

      // Workspace A's agent should no longer be streaming
      const workspaceA = unifiedStateStore.getWorkspace(workspaceAId);
      const agentA = workspaceA?.agents.get('agent-ws-a' as any);
      expect(agentA?.streaming.active).toBe(false);
    });
  });
});

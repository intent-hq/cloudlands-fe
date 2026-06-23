/**
 * Tests for Unified Persistence Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UnifiedPersistence } from '../agent-persistence';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';

function expectNoDuplicateNonEmptyAppMessageIds(messages: AgentMessage[] | undefined): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const message of messages ?? []) {
    if (!message.appMessageId) continue;
    if (seen.has(message.appMessageId)) duplicates.add(message.appMessageId);
    seen.add(message.appMessageId);
  }
  expect([...duplicates]).toEqual([]);
}

describe('UnifiedPersistence', () => {
  let persistence: UnifiedPersistence;
  let testDir: string;

  beforeEach(async () => {
    persistence = UnifiedPersistence.getInstance();
    testDir = path.join(process.cwd(), '.test-persistence');
    persistence.configure({ basePath: testDir });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    persistence.invalidateAllLoadCaches();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('saveAgent', () => {
    it('should save agent with atomic write', async () => {
      const agent: AgentSession = {
        id: 'agent-123' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const result = await persistence.saveAgent(agent, testDir);

      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.duration).toBeDefined();
    });

    it('should round-trip a Chief agent with lowercase idle status without invalid data logs', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const agent: AgentSession = {
        id: 'agent-chief-idle' as any,
        workspaceId: '__chief__' as any,
        name: 'Chief of Staff',
        status: AgentStatus.RuntimeIdle,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
        metadata: { chiefThread: true },
      };

      try {
        const saveResult = await persistence.saveAgent(agent, testDir);
        expect(saveResult.success).toBe(true);

        persistence.invalidateAllLoadCaches();
        const loadResult = await persistence.loadAgent(
          agent.id as any,
          agent.workspaceId as any,
          testDir,
        );

        expect(loadResult.success).toBe(true);
        expect(loadResult.data?.status).toBe(AgentStatus.RuntimeIdle);
        expect(
          errorSpy.mock.calls.flat().some((arg) => String(arg).includes('Invalid agent data')),
        ).toBe(false);
        expect(
          warnSpy.mock.calls
            .flat()
            .some((arg) => String(arg).includes('Agent data validation failed')),
        ).toBe(false);
      } finally {
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('should reject invalid agent data', async () => {
      const invalidAgent = {
        id: 'agent-123',
        workspaceId: 'workspace-test',
        // Missing other required fields
      } as any;

      const result = await persistence.saveAgent(invalidAgent, testDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should queue writes for same agent', async () => {
      const agent: AgentSession = {
        id: 'agent-123' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const result1 = persistence.saveAgent(agent, testDir);
      const result2 = persistence.saveAgent(agent, testDir);

      const [r1, r2] = await Promise.all([result1, result2]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('should remove logical duplicate messages before writing to disk', async () => {
      const agent: AgentSession = {
        id: 'agent-save-logical-dedup' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            appMessageId: 'app-msg-save',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Draft' }],
            timestamp: new Date('2026-05-04T10:00:00.000Z'),
          },
          {
            id: 'msg_backend_save',
            appMessageId: 'app-msg-save',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Final' }],
            timestamp: '2026-05-04T10:00:01.000Z',
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const result = await persistence.saveAgent(agent, testDir);

      expect(result.success).toBe(true);
      const raw = await fs.readFile(
        path.join(testDir, '.workspace/agents', `${agent.id}.json`),
        'utf-8',
      );
      const saved = JSON.parse(raw);
      expect(saved.messages).toHaveLength(1);
      expect(saved.messages[0]).toMatchObject({
        id: 'msg_backend_save',
        appMessageId: 'app-msg-save',
      });
      expect(saved.messages[0].timestamp).toBe('2026-05-04T10:00:01.000Z');
    });

    it('should load agent summaries without hydrating messages', async () => {
      const agent: AgentSession = {
        id: 'agent-summary' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Summary Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg_summary_1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Heavy message' }],
            timestamp: new Date('2026-05-04T10:00:00.000Z'),
          },
          {
            id: 'msg_summary_2',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Heavy response' }],
            timestamp: new Date('2026-05-04T10:01:00.000Z'),
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const saveResult = await persistence.saveAgent(agent, testDir);
      expect(saveResult.success).toBe(true);

      const parseSpy = vi.spyOn(JSON, 'parse');
      let summaryResult: Awaited<ReturnType<typeof persistence.loadAgentSummary>>;
      try {
        summaryResult = await persistence.loadAgentSummary(
          agent.id as any,
          agent.workspaceId as any,
          testDir,
        );
        expect(
          parseSpy.mock.calls.some(
            ([input]) => typeof input === 'string' && input.includes('Heavy message'),
          ),
        ).toBe(false);
      } finally {
        parseSpy.mockRestore();
      }

      expect(summaryResult.success).toBe(true);
      expect(summaryResult.data?.messages).toEqual([]);
      expect(summaryResult.data?.metadata?.messageCount).toBe(2);

      const fullResult = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );
      expect(fullResult.data?.messages).toHaveLength(2);
    });
  });

  describe('load cache trimming', () => {
    it('invalidates cached agent data after deleting an agent', async () => {
      const agent: AgentSession = {
        id: 'agent-cache-delete' as any,
        workspaceId: 'amber-forest' as any,
        name: 'Delete Cached Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);
      expect(
        await persistence.loadAgent(agent.id as any, agent.workspaceId as any, testDir),
      ).toMatchObject({ success: true });

      const deleteResult = await persistence.deleteAgent(agent.id, agent.workspaceId, testDir);
      expect(deleteResult.success).toBe(true);
      expect(
        await persistence.loadAgent(agent.id as any, agent.workspaceId as any, testDir),
      ).toMatchObject({ success: false });
    });

    it('evicts inactive completed load cache entries while retaining active entries', () => {
      const activeAgent: AgentSession = {
        id: 'agent-cache-active' as any,
        workspaceId: 'workspace-cache-active' as any,
        name: 'Active Cached Agent',
        status: AgentStatus.Active,
        messages: [
          { id: 'msg-active', role: 'user', contentBlocks: [], timestamp: new Date() },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };
      const inactiveAgent: AgentSession = {
        ...activeAgent,
        id: 'agent-cache-inactive' as any,
        workspaceId: 'workspace-cache-inactive' as any,
        name: 'Inactive Cached Agent',
        messages: [
          { id: 'msg-inactive', role: 'user', contentBlocks: [], timestamp: new Date() },
        ] as any[],
      };

      (persistence as any).loadCache.set('workspace-cache-active/agent-cache-active', {
        data: { success: true, data: activeAgent },
        timestamp: Date.now(),
      });
      (persistence as any).loadCache.set('workspace-cache-inactive/agent-cache-inactive', {
        data: { success: true, data: inactiveAgent },
        timestamp: Date.now(),
      });

      persistence.trimLoadCachesToOpenWorkspaces(['workspace-cache-active']);

      expect((persistence as any).loadCache.has('workspace-cache-active/agent-cache-active')).toBe(
        true,
      );
      expect(
        (persistence as any).loadCache.has('workspace-cache-inactive/agent-cache-inactive'),
      ).toBe(false);
    });

    it('retains inactive in-flight load promises so concurrent load de-duping still works', () => {
      const loadPromise = Promise.resolve({ success: false, error: 'not loaded yet' });
      (persistence as any).loadCache.set('workspace-cache-inactive/agent-cache-inflight', {
        data: { success: false, error: 'Loading...' },
        timestamp: Date.now(),
        loadPromise,
      });

      persistence.trimLoadCachesToOpenWorkspaces([]);

      expect(
        (persistence as any).loadCache.get('workspace-cache-inactive/agent-cache-inflight')
          ?.loadPromise,
      ).toBe(loadPromise);
    });

    it('does not re-cache a resolved in-flight load whose cache entry was swept by TTL', async () => {
      const cacheKey = 'workspace-closed-ttl/agent-inflight-ttl';
      const resolvedData = { success: true, data: { id: 'agent-inflight-ttl' } };
      let resolveLoad: (value: any) => void = () => {};
      const pending = new Promise((resolve) => {
        resolveLoad = resolve;
      });
      const diskSpy = vi
        .spyOn(persistence as any, 'loadAgentFromDisk')
        .mockReturnValue(pending as any);

      // Start the load but do not await it; this registers the in-flight key.
      const loadCall = persistence.loadAgent(
        'agent-inflight-ttl' as any,
        'workspace-closed-ttl' as any,
        testDir,
      );

      // Simulate the load cache entry being swept by its 2s TTL while the load
      // is still in flight, so loadCache.get(cacheKey) would return undefined.
      (persistence as any).loadCache.delete(cacheKey);

      // Trim with no open workspaces: the in-flight load must still mark the
      // closed workspace inactive even though the cache entry is gone.
      persistence.trimLoadCachesToOpenWorkspaces([]);
      expect((persistence as any).inactiveLoadCacheWorkspaces.has('workspace-closed-ttl')).toBe(
        true,
      );

      // Resolve the load: the guard must delete instead of re-cache.
      resolveLoad(resolvedData);
      const result = await loadCall;
      expect(result).toBe(resolvedData);
      expect((persistence as any).loadCache.has(cacheKey)).toBe(false);

      diskSpy.mockRestore();
    });

    it('clears retained load and pending state for a cleared workspace only', async () => {
      const targetAgent: AgentSession = {
        id: 'agent-clear-workspace-target' as any,
        workspaceId: 'amber-forest' as any,
        name: 'Target Workspace Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };
      const otherAgent: AgentSession = {
        ...targetAgent,
        id: 'agent-clear-workspace-other' as any,
        workspaceId: 'green-hill' as any,
      };

      (persistence as any).loadCache.set('amber-forest/agent-clear-workspace-target', {
        data: { success: true, data: targetAgent },
        timestamp: Date.now(),
      });
      (persistence as any).loadCache.set('green-hill/agent-clear-workspace-other', {
        data: { success: true, data: otherAgent },
        timestamp: Date.now(),
      });
      (persistence as any).inactiveLoadCacheWorkspaces.add('amber-forest');
      (persistence as any).inactiveLoadCacheWorkspaces.add('green-hill');
      persistence.markAgentPending(targetAgent.id, targetAgent);
      persistence.markAgentPending(otherAgent.id, otherAgent);

      await persistence.clearWorkspace('amber-forest');

      expect((persistence as any).loadCache.has('amber-forest/agent-clear-workspace-target')).toBe(
        false,
      );
      expect((persistence as any).loadCache.has('green-hill/agent-clear-workspace-other')).toBe(
        true,
      );
      expect((persistence as any).inactiveLoadCacheWorkspaces.has('amber-forest')).toBe(false);
      expect((persistence as any).inactiveLoadCacheWorkspaces.has('green-hill')).toBe(true);
      expect((persistence as any).pendingAgents.has(targetAgent.id)).toBe(false);
      expect((persistence as any).pendingAgents.has(otherAgent.id)).toBe(true);
    });

    it('clears all retained load and pending state when clearing all persistence data', async () => {
      const agent: AgentSession = {
        id: 'agent-clear-all' as any,
        workspaceId: 'amber-forest' as any,
        name: 'Clear All Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      (persistence as any).loadCache.set('amber-forest/agent-clear-all', {
        data: { success: true, data: agent },
        timestamp: Date.now(),
      });
      (persistence as any).inactiveLoadCacheWorkspaces.add('amber-forest');
      persistence.markAgentPending(agent.id, agent);

      await persistence.clearAll();

      expect((persistence as any).loadCache.size).toBe(0);
      expect((persistence as any).inactiveLoadCacheWorkspaces.size).toBe(0);
      expect((persistence as any).pendingAgents.size).toBe(0);
    });

    it('clears retained caches and pending agents on shutdown', async () => {
      const agent: AgentSession = {
        id: 'agent-cache-shutdown' as any,
        workspaceId: 'workspace-cache-shutdown' as any,
        name: 'Shutdown Cached Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      (persistence as any).loadCache.set('workspace-cache-shutdown/agent-cache-shutdown', {
        data: { success: true, data: agent },
        timestamp: Date.now(),
      });
      (persistence as any).inactiveLoadCacheWorkspaces.add('workspace-cache-shutdown');
      persistence.markAgentPending(agent.id, agent);

      await persistence.shutdown();

      expect((persistence as any).loadCache.size).toBe(0);
      expect((persistence as any).inactiveLoadCacheWorkspaces.size).toBe(0);
      expect((persistence as any).pendingAgents.size).toBe(0);
    });
  });

  describe('user message preservation on save', () => {
    it('should prepend missing user messages when backend save has assistant but no user messages', async () => {
      // Simulate: disk has [user, assistant] from a previous save.
      // Backend streams a new response and saves [assistant_new] without the user message
      // (because it loaded the session before the frontend wrote the user message).
      // The guard should prepend the missing user message from disk.
      const agent: AgentSession = {
        id: 'agent-preserve-1' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg_user_1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg_asst_1',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Hi' }],
            timestamp: new Date().toISOString(),
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // First save: write [user, assistant] to disk
      await persistence.saveAgent(agent, testDir);

      // Second save: backend has only [assistant_new] — no user message
      const staleBackendSave: AgentSession = {
        ...agent,
        messages: [
          {
            id: 'msg_asst_new',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Streaming response' }],
            timestamp: new Date().toISOString(),
          },
        ] as any[],
      };

      await persistence.saveAgent(staleBackendSave, testDir);

      // Load and verify: user message from disk should be prepended
      // Invalidate cache to ensure we read from disk
      persistence.invalidateAllLoadCaches();

      const loadResult = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.messages).toHaveLength(2);
      expect(loadResult.data?.messages[0].role).toBe('user');
      expect(loadResult.data?.messages[0].id).toBe('msg_user_1');
      expect(loadResult.data?.messages[1].role).toBe('assistant');
      expect(loadResult.data?.messages[1].id).toBe('msg_asst_new');
    });

    it('preserves newest disk user message when stale backend save includes older users plus assistant', async () => {
      const agent: AgentSession = {
        id: 'agent-preserve-newest-user' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg_user_1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: '2026-05-04T10:00:00.000Z',
          },
          {
            id: 'msg_asst_1',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Hi' }],
            timestamp: '2026-05-04T10:01:00.000Z',
          },
          {
            id: 'msg_user_2',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Newest question' }],
            timestamp: '2026-05-04T10:02:00.000Z',
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);

      const staleBackendSave: AgentSession = {
        ...agent,
        messages: [
          agent.messages[0],
          agent.messages[1],
          {
            id: 'msg_asst_2',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'New answer' }],
            timestamp: '2026-05-04T10:03:00.000Z',
          },
        ] as any[],
      };

      await persistence.saveAgent(staleBackendSave, testDir);

      persistence.invalidateAllLoadCaches();
      const loadResult = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(loadResult.success).toBe(true);
      const loadedMessages = loadResult.data?.messages ?? [];
      expect(loadedMessages.map((message) => message.id)).toEqual([
        'msg_user_1',
        'msg_asst_1',
        'msg_user_2',
        'msg_asst_2',
      ]);
      expect(loadedMessages.filter((message) => message.id === 'msg_user_2')).toHaveLength(1);
      expect(loadedMessages.filter((message) => message.id === 'msg_asst_2')).toHaveLength(1);
    });

    it('should NOT prepend when incoming save has user messages', async () => {
      // Normal save: backend has both user and assistant messages — no preservation needed
      const agent: AgentSession = {
        id: 'agent-preserve-2' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg_user_1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg_asst_1',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Hi' }],
            timestamp: new Date().toISOString(),
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);

      // Second save has both user and assistant — should NOT trigger preservation
      const normalSave: AgentSession = {
        ...agent,
        messages: [
          {
            id: 'msg_user_2',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'New question' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg_asst_2',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'New answer' }],
            timestamp: new Date().toISOString(),
          },
        ] as any[],
      };

      await persistence.saveAgent(normalSave, testDir);

      // Invalidate cache to ensure we read from disk
      persistence.invalidateAllLoadCaches();

      const loadResult = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.messages).toHaveLength(2);
      expect(loadResult.data?.messages[0].id).toBe('msg_user_2');
      expect(loadResult.data?.messages[1].id).toBe('msg_asst_2');
    });
  });

  describe('loadAgent', () => {
    it('should load saved agent', async () => {
      const agent: AgentSession = {
        id: 'agent-123' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(agent.id);
      expect(result.data?.name).toBe(agent.name);
    });

    it('should return failure for non-existent agent', async () => {
      const result = await persistence.loadAgent(
        'agent-non-existent' as any,
        'workspace-550e8400-e29b-41d4-a716-446655440000' as any,
        testDir,
      );

      // The implementation returns failure when agent doesn't exist
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should remove logical duplicate messages loaded from disk', async () => {
      const agent: AgentSession = {
        id: 'agent-load-logical-dedup' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            appMessageId: 'app-msg-load',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Draft' }],
            timestamp: '2026-05-04T10:00:00.000Z',
          },
          {
            id: 'msg_backend_load',
            appMessageId: 'app-msg-load',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Final' }],
            timestamp: '2026-05-04T10:00:01.000Z',
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };
      const agentFilePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
      await fs.mkdir(path.dirname(agentFilePath), { recursive: true });
      await fs.writeFile(agentFilePath, JSON.stringify(agent), 'utf-8');

      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.messages).toHaveLength(1);
      expect(result.data?.messages[0]).toMatchObject({
        id: 'msg_backend_load',
        appMessageId: 'app-msg-load',
      });
      expect(result.data?.messages[0].timestamp).toBe('2026-05-04T10:00:01.000Z');
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('hydrates observed same-appMessageId assistant duplicates as one logical message', async () => {
      const appMessageId = 'app-observed-hydrate';
      const agent: AgentSession = {
        id: 'agent-load-observed-duplicate' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Observed Duplicate Agent',
        status: AgentStatus.Active,
        messages: [
          {
            id: 'msg_user_observed',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Please inspect' }],
            timestamp: '2026-05-04T10:00:00.000Z',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            appMessageId,
            role: 'assistant',
            contentBlocks: [
              { type: 'text', text: 'I inspected the file.' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
            ],
            timestamp: '2026-05-04T10:00:01.000Z',
            isStreaming: true,
          },
          {
            id: 'msg_backend_hydrated_final',
            appMessageId,
            role: 'assistant',
            contentBlocks: [
              { type: 'text', text: 'I inspected the file.' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/foo.ts' } },
              { type: 'tool_result', tool_use_id: 'toolu_1', output: { content: 'file contents' } },
            ],
            timestamp: '2026-05-04T10:00:02.000Z',
            isStreaming: false,
          },
        ] as any[],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };
      const agentFilePath = path.join(testDir, '.workspace/agents', `${agent.id}.json`);
      await fs.mkdir(path.dirname(agentFilePath), { recursive: true });
      await fs.writeFile(agentFilePath, JSON.stringify(agent), 'utf-8');

      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      const loadedMessages = result.data?.messages ?? [];
      expect(loadedMessages.map((message) => message.id)).toEqual([
        'msg_user_observed',
        'msg_backend_hydrated_final',
      ]);
      expect(loadedMessages[1]).toMatchObject({ appMessageId, isStreaming: false });
      expectNoDuplicateNonEmptyAppMessageIds(loadedMessages);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('name preservation on save', () => {
    it('should preserve intentional name when incoming name is generic (regression)', async () => {
      // Bug: saveAgent only preserved name when incoming had NO name.
      // If incoming had a generic name like "Task Agent", it would overwrite
      // an intentional name like "Coordinator" that was set via setAgentName.
      const agent: AgentSession = {
        id: 'agent-123' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'New Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Step 1: Save agent with generic name
      await persistence.saveAgent(agent, testDir);

      // Step 2: Simulate setAgentName writing "Coordinator" to disk
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-123.json');
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.version && data.data) {
        data.data.name = 'Coordinator';
      } else {
        data.name = 'Coordinator';
      }
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Step 3: Save again with generic name (simulating frontend save with stale data)
      await persistence.saveAgent(agent, testDir);

      // Step 4: Load and verify the intentional name was preserved
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Coordinator');
    });

    it('should preserve intentional name when incoming name is random adjective-animal (regression)', async () => {
      // Bug: saveAgent would overwrite an intentional name with a random
      // "Adjective Animal" name because it only checked for empty/missing names.
      const agent: AgentSession = {
        id: 'agent-456' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Swift Falcon',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Step 1: Save agent with random name
      await persistence.saveAgent(agent, testDir);

      // Step 2: Simulate setAgentName writing an intentional name to disk
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-456.json');
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.version && data.data) {
        data.data.name = 'Fix login bug';
      } else {
        data.name = 'Fix login bug';
      }
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Step 3: Save again with random name (simulating frontend save with stale data)
      await persistence.saveAgent(agent, testDir);

      // Step 4: Load and verify the intentional name was preserved
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Fix login bug');
    });

    it('should preserve explicitly-set name even when incoming name is text-derived (regression)', async () => {
      const agent: AgentSession = {
        id: 'agent-789' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Repo overview',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Step 1: Save agent with text-derived name
      await persistence.saveAgent(agent, testDir);

      // Step 2: Simulate setAgentName modifying disk directly
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-789.json');
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.version && data.data) {
        data.data.name = 'My Custom Name';
        data.data.nameExplicitlySet = true;
      } else {
        data.name = 'My Custom Name';
        data.nameExplicitlySet = true;
      }
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Step 3: Save again with stale in-memory data (no nameExplicitlySet)
      await persistence.saveAgent(agent, testDir);

      // Step 4: Load and verify the explicitly-set name was preserved
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('My Custom Name');
    });

    it('saveAgent does not override an explicit disk name even when incoming save has the flag (renameAgent is required for re-rename)', async () => {
      // A saveAgent snapshot carrying nameExplicitlySet: true is
      // indistinguishable from a stale full-session save captured just
      // after an earlier rename. The defensive re-read inside the write
      // lock therefore treats the disk as authoritative whenever the
      // on-disk copy is explicitly set and its name disagrees with the
      // incoming save — this protects a later rename from being clobbered
      // by a racing stale save. Explicit re-renames must go through
      // renameAgent.
      const agent: AgentSession = {
        id: 'agent-890' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Repo overview',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Step 1: Save agent with text-derived name
      await persistence.saveAgent(agent, testDir);

      // Step 2: Simulate setAgentName modifying disk directly
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-890.json');
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.version && data.data) {
        data.data.name = 'My Custom Name';
        data.data.nameExplicitlySet = true;
      } else {
        data.name = 'My Custom Name';
        data.nameExplicitlySet = true;
      }
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Step 3: saveAgent with nameExplicitlySet — must NOT clobber the
      // disk name (treated as a potentially stale save).
      (agent as any).nameExplicitlySet = true;
      agent.name = 'Even Newer Name';
      await persistence.saveAgent(agent, testDir);

      // Step 4: Load and verify the disk name survived.
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('My Custom Name');
      expect(result.data?.nameExplicitlySet).toBe(true);

      // Step 5: renameAgent is the authoritative path for an explicit
      // re-rename and DOES take effect.
      const renameResult = await persistence.renameAgent(
        agent.id as string,
        agent.workspaceId as string,
        'Even Newer Name',
        { workspacePath: testDir },
      );
      expect(renameResult.ok).toBe(true);

      const renamed = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );
      expect(renamed.data?.name).toBe('Even Newer Name');
      expect(renamed.data?.nameExplicitlySet).toBe(true);
    });
  });

  describe('completion report preservation on save', () => {
    it('should preserve metadata.completionReport from disk when incoming save lacks it (regression)', async () => {
      // Bug: ReportToParentTool writes metadata.completionReport directly to disk.
      // A concurrent in-memory save (frontend/streaming) with stale metadata would
      // clobber the report because saveAgent didn't preserve it.
      const agent: AgentSession = {
        id: 'agent-report-1' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      // Step 1: First save (establishes the file on disk).
      await persistence.saveAgent(agent, testDir);

      // Step 2: Simulate ReportToParentTool writing a completion report directly.
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-report-1.json');
      const reportTimestamp = '2026-04-17T12:00:00.000Z';
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      const target = data.version && data.data ? data.data : data;
      target.metadata = {
        ...(target.metadata || {}),
        completionReport: 'hello',
        completionReportTimestamp: reportTimestamp,
      };
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Step 3: Save again with stale in-memory data that carries unrelated metadata
      // but no completionReport field.
      const staleSave: AgentSession = {
        ...agent,
        metadata: { someOtherField: 123 } as any,
      } as any;
      await persistence.saveAgent(staleSave, testDir);

      // Step 4: Load and verify the completion report was preserved AND other
      // metadata keys from the incoming save are kept.
      persistence.invalidateAllLoadCaches();
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      const loadedMetadata = (result.data as any)?.metadata;
      expect(loadedMetadata?.completionReport).toBe('hello');
      expect(loadedMetadata?.completionReportTimestamp).toBe(reportTimestamp);
      expect(loadedMetadata?.someOtherField).toBe(123);
    });

    it('should preserve metadata.completionReport when incoming save has no metadata at all', async () => {
      const agent: AgentSession = {
        id: 'agent-report-2' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);

      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-report-2.json');
      const reportTimestamp = '2026-04-17T12:30:00.000Z';
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      const target = data.version && data.data ? data.data : data;
      target.metadata = {
        completionReport: 'done',
        completionReportTimestamp: reportTimestamp,
      };
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Incoming save has no metadata at all.
      await persistence.saveAgent(agent, testDir);

      persistence.invalidateAllLoadCaches();
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      const loadedMetadata = (result.data as any)?.metadata;
      expect(loadedMetadata?.completionReport).toBe('done');
      expect(loadedMetadata?.completionReportTimestamp).toBe(reportTimestamp);
    });

    it('should allow incoming save to overwrite completionReport when provided explicitly', async () => {
      const agent: AgentSession = {
        id: 'agent-report-3' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      await persistence.saveAgent(agent, testDir);

      // Seed disk with an initial completion report.
      const agentFilePath = path.join(testDir, '.workspace/agents', 'agent-report-3.json');
      const raw = await fs.readFile(agentFilePath, 'utf-8');
      const data = JSON.parse(raw);
      const target = data.version && data.data ? data.data : data;
      target.metadata = {
        completionReport: 'old report',
        completionReportTimestamp: '2026-04-17T10:00:00.000Z',
      };
      await fs.writeFile(agentFilePath, JSON.stringify(data, null, 2), 'utf-8');

      // Incoming save explicitly supplies a new completion report — should win.
      const newTimestamp = '2026-04-17T13:00:00.000Z';
      const overwriteSave: AgentSession = {
        ...agent,
        metadata: {
          completionReport: 'new report',
          completionReportTimestamp: newTimestamp,
        } as any,
      } as any;
      await persistence.saveAgent(overwriteSave, testDir);

      persistence.invalidateAllLoadCaches();
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      const loadedMetadata = (result.data as any)?.metadata;
      expect(loadedMetadata?.completionReport).toBe('new report');
      expect(loadedMetadata?.completionReportTimestamp).toBe(newTimestamp);
    });
  });

  describe('backup and recovery', () => {
    it('should handle multiple writes atomically', async () => {
      const agent: AgentSession = {
        id: 'agent-123' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        backendSessionId: null,
      };

      const result1 = await persistence.saveAgent(agent, testDir);
      expect(result1.success).toBe(true);

      agent.name = 'Updated Agent';
      const result2 = await persistence.saveAgent(agent, testDir);
      expect(result2.success).toBe(true);

      // Verify we can load the updated agent
      const loadResult = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.name).toBe('Updated Agent');
    });
  });
});

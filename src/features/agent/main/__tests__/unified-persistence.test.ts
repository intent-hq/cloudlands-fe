/**
 * Tests for Unified Persistence Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UnifiedPersistence } from '../agent-persistence';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';

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
          { id: 'msg_user_1', role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: new Date().toISOString() },
          { id: 'msg_asst_1', role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: new Date().toISOString() },
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
          { id: 'msg_asst_new', role: 'assistant', contentBlocks: [{ type: 'text', text: 'Streaming response' }], timestamp: new Date().toISOString() },
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

    it('should NOT prepend when incoming save has user messages', async () => {
      // Normal save: backend has both user and assistant messages — no preservation needed
      const agent: AgentSession = {
        id: 'agent-preserve-2' as any,
        workspaceId: '550e8400-e29b-41d4-a716-446655440000' as any,
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [
          { id: 'msg_user_1', role: 'user', contentBlocks: [{ type: 'text', text: 'Hello' }], timestamp: new Date().toISOString() },
          { id: 'msg_asst_1', role: 'assistant', contentBlocks: [{ type: 'text', text: 'Hi' }], timestamp: new Date().toISOString() },
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
          { id: 'msg_user_2', role: 'user', contentBlocks: [{ type: 'text', text: 'New question' }], timestamp: new Date().toISOString() },
          { id: 'msg_asst_2', role: 'assistant', contentBlocks: [{ type: 'text', text: 'New answer' }], timestamp: new Date().toISOString() },
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

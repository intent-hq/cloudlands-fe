/**
 * Tests for Unified Persistence Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('should allow rename when incoming save also has nameExplicitlySet (user re-rename)', async () => {
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

      // Step 3: Save with nameExplicitlySet (simulating user re-rename)
      (agent as any).nameExplicitlySet = true;
      agent.name = 'Even Newer Name';
      await persistence.saveAgent(agent, testDir);

      // Step 4: Load and verify the new name took effect
      const result = await persistence.loadAgent(
        agent.id as any,
        agent.workspaceId as any,
        testDir,
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Even Newer Name');
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

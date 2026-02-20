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

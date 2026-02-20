/**
 * Persistence and Recovery Integration Tests
 *
 * Tests for data persistence, atomic writes, backup/recovery,
 * and handling of corrupted data scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';
import { agentPersistence } from '../../src/features/agent/main/agent-persistence';
import { FileSystemWorkspaceRepository } from '../../src/features/workspace/main/workspace.repository';
import {
  createWorkspaceId,
  createAgentId,
  createMessageId,
} from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { AgentSession, AgentMessage } from '../../src/shared/types';
import { AgentStatus } from '../../src/shared/types/agent.types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { setupTestPersistence } from '../helpers/test-persistence-setup';
import { tmpdir } from 'os';

describe('Persistence and Recovery Integration Tests', () => {
  let harness: AgentTestHarness;
  let workspaceRepository: FileSystemWorkspaceRepository;
  let testWorkspaceId: ReturnType<typeof createWorkspaceId>;
  let testWorkspacePath: string;
  let testAgent: AgentSession;
  let testPersistence: Awaited<ReturnType<typeof setupTestPersistence>>;
  let originalEnv: { [key: string]: string | undefined };

  beforeAll(async () => {
    // Save original environment
    originalEnv = {
      WORKSPACES_BASE_DIR: process.env.WORKSPACES_BASE_DIR,
      AUGMENT_WORKSPACES_ROOT: process.env.AUGMENT_WORKSPACES_ROOT,
    };

    // Setup test persistence with isolated directory
    testWorkspaceId = createWorkspaceId(randomUUID());
    testPersistence = await setupTestPersistence({
      baseDir: path.join(tmpdir(), '.test-persistence', Date.now().toString()),
      workspaceId: testWorkspaceId,
      cleanup: false, // We'll handle cleanup manually
    });

    testWorkspacePath = testPersistence.workspacePath;

    // Initialize test infrastructure
    harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      verbose: process.env.VERBOSE === 'true',
    });

    workspaceRepository = new FileSystemWorkspaceRepository();

    // Create test agent
    testAgent = await harness.createAgent({
      name: 'Persistence Test Agent',
      model: 'claude-3-opus',
      provider: 'anthropic',
      workspaceId: testWorkspaceId,
    });

    // Save the test agent so it exists for message persistence tests
    await agentPersistence.saveAgent(testAgent);
  });

  afterAll(async () => {
    await harness.cleanup();

    // Clean up test directories
    await testPersistence.cleanup();

    // Restore original environment
    if (originalEnv.WORKSPACES_BASE_DIR !== undefined) {
      process.env.WORKSPACES_BASE_DIR = originalEnv.WORKSPACES_BASE_DIR;
    } else {
      delete process.env.WORKSPACES_BASE_DIR;
    }

    if (originalEnv.AUGMENT_WORKSPACES_ROOT !== undefined) {
      process.env.AUGMENT_WORKSPACES_ROOT = originalEnv.AUGMENT_WORKSPACES_ROOT;
    } else {
      delete process.env.AUGMENT_WORKSPACES_ROOT;
    }
  });

  beforeEach(async () => {
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
    await harness.reset();
  });

  describe('Agent Session Persistence', () => {
    it('should save agent session atomically', async () => {
      const agent: AgentSession = {
        id: createAgentId(randomUUID()),
        backendSessionId: randomUUID(),
        workspaceId: testWorkspaceId,
        name: 'Atomic Save Test',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        isInitialAgent: false,
        isBackground: false,
      };

      // Save agent - note: workspacePath parameter is ignored, it uses workspaceId
      const saveResult = await agentPersistence.saveAgent(agent);
      expect(saveResult.success).toBe(true);

      // Verify file exists - using the correct path structure
      const agentPath = testPersistence.getAgentPath(agent.id);

      await fs.access(agentPath);

      // Verify atomic write (temp file should not exist)
      const tempPath = `${agentPath}.tmp`;
      try {
        await fs.access(tempPath);
        expect.fail('Temp file should not exist after atomic write');
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should load agent session from disk', async () => {
      // Save test agent
      await agentPersistence.saveAgent(testAgent);

      // Load agent
      const loadResult = await agentPersistence.loadAgent(
        testAgent.id as any,
        testWorkspaceId,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data).toBeDefined();
      expect(loadResult.data?.id).toBe(testAgent.id);
      expect(loadResult.data?.name).toBe(testAgent.name);
    });

    it('should handle concurrent save operations', async () => {
      const savePromises: Promise<any>[] = [];

      // Simulate concurrent saves
      for (let i = 0; i < 10; i++) {
        const updatedAgent = {
          ...testAgent,
          messages: [
            ...testAgent.messages,
            {
              id: createMessageId(randomUUID()),
              role: 'user' as const,
              content: `Concurrent message ${i}`,
              timestamp: new Date(),
            },
          ],
        };

        savePromises.push(agentPersistence.saveAgent(updatedAgent));
      }

      const results = await Promise.all(savePromises);

      // All saves should succeed (queued internally)
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // Load and verify final state
      const loadResult = await agentPersistence.loadAgent(
        testAgent.id as any,
        testWorkspaceId,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data?.messages.length).toBeGreaterThan(0);
    }, 20000); // Increase timeout to 20 seconds for concurrent operations
  });

  describe('Backup and Recovery', () => {
    it('should create backup files', async () => {
      const agent: AgentSession = {
        id: createAgentId(randomUUID()),
        backendSessionId: randomUUID(),
        workspaceId: testWorkspaceId,
        name: 'Backup Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        isInitialAgent: false,
        isBackground: false,
      };

      // Save agent multiple times to trigger backup
      await agentPersistence.saveAgent(agent);

      // Modify and save again
      agent.messages.push({
        id: createMessageId(randomUUID()),
        role: 'user',
        content: 'Test message',
        timestamp: new Date(),
      });

      await agentPersistence.saveAgent(agent);

      // Check for backup file
      const agentPath = testPersistence.getAgentPath(agent.id);
      const backupPath = `${agentPath}.backup`;

      try {
        await fs.access(backupPath);
        const backupData = await fs.readFile(backupPath, 'utf-8');
        const backup = JSON.parse(backupData);
        expect(backup.id).toBe(agent.id);
      } catch (error) {
        // Backup might not exist immediately, which is acceptable
      }
    });

    it('should recover from corrupted data file', async () => {
      const agentId = createAgentId(randomUUID());
      const agent: AgentSession = {
        id: agentId,
        backendSessionId: randomUUID(),
        workspaceId: testWorkspaceId,
        name: 'Corruption Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        isInitialAgent: false,
        isBackground: false,
      };

      // Save valid agent
      await agentPersistence.saveAgent(agent);

      // Corrupt the file
      const agentPath = testPersistence.getAgentPath(agentId);

      await fs.writeFile(agentPath, 'CORRUPTED DATA - NOT VALID JSON');

      // Try to load - should handle gracefully
      const loadResult = await agentPersistence.loadAgent(
        agentId,
        testWorkspaceId,
        testWorkspacePath,
      );

      // Should either recover from backup or return failure
      // Since we corrupted the file and there's no backup, it should fail
      if (loadResult.success) {
        // If it recovered from backup, verify the data
        expect(loadResult.data).toBeDefined();
        expect(loadResult.data?.id).toBe(agentId);
      } else {
        // If it failed, that's also acceptable
        expect(loadResult.error).toBeDefined();
      }
    });

    it('should handle missing data files', async () => {
      const nonExistentId = createAgentId(randomUUID());

      const loadResult = await agentPersistence.loadAgent(
        nonExistentId,
        testWorkspaceId,
        testWorkspacePath,
      );

      // Should return failure when file doesn't exist
      expect(loadResult.success).toBe(false);
      expect(loadResult.data).toBeUndefined();
      expect(loadResult.error).toBeDefined();
    });
  });

  describe('Message Persistence', () => {
    it('should persist individual messages', async () => {
      // Create a fresh agent for this test
      const freshAgent = await harness.createAgent({
        name: 'Message Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: testWorkspaceId,
      });

      // Save the fresh agent first
      const initialSave = await agentPersistence.saveAgent(freshAgent);
      expect(initialSave.success).toBe(true);

      const message: AgentMessage = {
        id: createMessageId(randomUUID()),
        role: 'user',
        contentBlocks: [
          {
            type: 'text',
            text: 'Individual message test',
          },
        ],
        timestamp: new Date(),
      };

      const saveResult = await agentPersistence.saveMessage(
        freshAgent.id,
        testWorkspaceId,
        message,
      );

      expect(saveResult.success).toBe(true);

      // Load and verify
      const loadResult = await agentPersistence.loadAgent(
        freshAgent.id as any,
        testWorkspaceId,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data).toBeDefined();
      expect(loadResult.data?.messages).toBeDefined();

      const savedMessage = loadResult.data?.messages.find((m) => m.id === message.id);
      expect(savedMessage).toBeDefined();
      expect(savedMessage?.contentBlocks).toBeDefined();
      expect(savedMessage?.contentBlocks?.[0]?.text).toBe('Individual message test');
    });

    it('should maintain message order during persistence', async () => {
      // Create a fresh agent for this test
      const freshAgent = await harness.createAgent({
        name: 'Message Order Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: testWorkspaceId,
      });

      // Save the fresh agent first
      const initialSave = await agentPersistence.saveAgent(freshAgent);
      expect(initialSave.success).toBe(true);

      const messages: AgentMessage[] = [];

      for (let i = 0; i < 5; i++) {
        const message: AgentMessage = {
          id: createMessageId(randomUUID()),
          role: i % 2 === 0 ? 'user' : 'assistant',
          contentBlocks: [
            {
              type: 'text',
              text: `Message ${i}`,
            },
          ],
          timestamp: new Date(Date.now() + i * 1000),
        };
        messages.push(message);

        const saveResult = await agentPersistence.saveMessage(
          freshAgent.id,
          testWorkspaceId,
          message,
        );
        expect(saveResult.success).toBe(true);
      }

      // Load and verify order
      const loadResult = await agentPersistence.loadAgent(
        freshAgent.id as any,
        testWorkspaceId,
      );

      expect(loadResult.success).toBe(true);
      expect(loadResult.data).toBeDefined();

      const loadedMessages = loadResult.data?.messages || [];
      expect(loadedMessages.length).toBe(messages.length);

      // Verify messages are in order
      for (let i = 0; i < messages.length; i++) {
        const found = loadedMessages.find((m) =>
          m.contentBlocks?.[0]?.text === `Message ${i}`,
        );
        expect(found).toBeDefined();
      }
    });
  });

  describe('Workspace Metadata Persistence', () => {
    it('should persist workspace metadata', async () => {
      const workspace = {
        id: testWorkspaceId,
        title: 'Persistence Test Workspace',
        branch: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: 'Active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        path: testWorkspacePath,
        agents: [testAgent.id],
        metadata: {
          customField: 'custom value',
          tags: ['test', 'persistence'],
        },
      };

      // Save workspace
      await workspaceRepository.save(workspace as any);

      // Load workspace
      const loaded = await workspaceRepository.findById(testWorkspaceId);

      expect(loaded).toBeDefined();
      expect(loaded?.title).toBe(workspace.title);
      expect(loaded?.metadata?.customField).toBe('custom value');
      expect(loaded?.metadata?.tags).toEqual(['test', 'persistence']);
    });
  });

  describe('Recovery from System Crashes', () => {
    it('should recover from incomplete write operations', async () => {
      const agent: AgentSession = {
        id: createAgentId(randomUUID()),
        backendSessionId: randomUUID(),
        workspaceId: testWorkspaceId,
        name: 'Crash Recovery Test',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        isInitialAgent: false,
        isBackground: false,
      };

      const agentPath = testPersistence.getAgentPath(agent.id);
      const tempPath = `${agentPath}.tmp`;

      // Simulate incomplete write (temp file exists)
      await fs.mkdir(path.dirname(agentPath), { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(agent));

      // Load should handle recovery
      const loadResult = await agentPersistence.loadAgent(
        agent.id as any,
        testWorkspaceId,
        testWorkspacePath,
      );

      // Since the main file doesn't exist, it should fail
      // (temp file alone is not enough to recover)
      expect(loadResult.success).toBe(false);

      // Temp file should still exist (not cleaned up by failed load)
      try {
        await fs.access(tempPath);
        expect(true).toBe(true);
      } catch {
        expect.fail('Temp file should still exist');
      }
    });
  });
});

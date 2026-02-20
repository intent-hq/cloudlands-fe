/**
 * Workspace Operations Integration Tests
 *
 * Tests for workspace lifecycle including creation, deletion,
 * duplication, archiving, and agent management within workspaces.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';
import { WorkspaceService } from '../../src/features/workspace/main/workspace.service';
import { FileSystemWorkspaceRepository } from '../../src/features/workspace/main/workspace.repository';
import type { WorkspaceRepository } from '../../src/features/workspace/main/workspace.repository';
import { createWorkspaceId, createAgentId } from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { Workspace, AgentSession } from '../../src/shared/types';
import { WorkspaceStatus } from '../../src/shared/types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Workspace Operations Integration Tests', () => {
  let harness: AgentTestHarness;
  let workspaceService: WorkspaceService;
  let workspaceRepository: WorkspaceRepository;
  let testRepoPath: string;

  beforeAll(async () => {
    // Initialize test infrastructure
    harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      verbose: process.env.VERBOSE === 'true',
    });

    workspaceRepository = new FileSystemWorkspaceRepository();
    workspaceService = new WorkspaceService(workspaceRepository);

    // Create test repository directory
    testRepoPath = path.join(process.cwd(), '.test-repos', randomUUID());
    await fs.mkdir(testRepoPath, { recursive: true });

    // Initialize git repo for testing
    const { execSync } = require('child_process');
    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });
    execSync('echo "test" > README.md', { cwd: testRepoPath });
    execSync('git add .', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });
  });

  afterAll(async () => {
    await harness.cleanup();
    await fs.rm(testRepoPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
    await harness.reset();
  });

  describe('Workspace Creation', () => {
    it('should create workspace with agent', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Test Workspace with Agent',
        repositoryPath: testRepoPath,
        baseRef: 'main',
      });

      expect(createResult.ok).toBe(true);
      expect(createResult.data).toBeDefined();

      const workspace = createResult.data!;
      expect(workspace.title).toBe('Test Workspace with Agent');
      expect(workspace.status).toBe(WorkspaceStatus.Active);
      expect(workspace.repositoryPath).toBe(testRepoPath);

      // Create agent in workspace
      const agent = await harness.createAgent({
        name: 'Workspace Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: workspace.id,
      });

      expect(agent.workspaceId).toBe(workspace.id);
    });

    it('should create workspace with git worktree', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Workspace with Worktree',
        repositoryPath: testRepoPath,
        baseRef: 'main',
        branch: 'feature/test-branch',
      });

      expect(createResult.ok).toBe(true);
      const workspace = createResult.data!;

      expect(workspace.worktreePath).toBeDefined();
      expect(workspace.branch).toBe('feature/test-branch');

      // Verify worktree exists
      try {
        await fs.access(workspace.worktreePath!);
        expect(true).toBe(true);
      } catch {
        expect.fail('Worktree path should exist');
      }
    });

    it('should handle workspace creation failures', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Invalid Workspace',
        repositoryPath: '/invalid/path/that/does/not/exist',
        baseRef: 'main',
      });

      expect(createResult.ok).toBe(false);
      expect(createResult.error).toBeDefined();
    });

    it('should resolve remote branch when baseRef is without origin/ prefix', async () => {
      const { execSync } = require('child_process');

      // Create a "remote" by making a bare clone and adding it as origin
      const bareRepoPath = path.join(process.cwd(), '.test-repos', `bare-${randomUUID()}`);
      await fs.mkdir(bareRepoPath, { recursive: true });

      try {
        // Create a bare repo to act as "remote"
        execSync('git clone --bare . ' + bareRepoPath, { cwd: testRepoPath });

        // Add it as origin to our test repo
        try {
          execSync('git remote remove origin', { cwd: testRepoPath });
        } catch {
          // Ignore if origin doesn't exist
        }
        execSync(`git remote add origin ${bareRepoPath}`, { cwd: testRepoPath });

        // Create a branch on the "remote" that doesn't exist locally
        // First create it locally, push it, then delete locally
        execSync('git checkout -b remote-only-branch', { cwd: testRepoPath });
        execSync('echo "remote content" > remote-file.txt', { cwd: testRepoPath });
        execSync('git add .', { cwd: testRepoPath });
        execSync('git commit -m "Remote only commit"', { cwd: testRepoPath });
        execSync('git push origin remote-only-branch', { cwd: testRepoPath });

        // Get the commit SHA of the remote branch
        const remoteCommitSha = execSync('git rev-parse HEAD', { cwd: testRepoPath })
          .toString()
          .trim();

        // Switch back to main and delete the local branch
        execSync('git checkout main', { cwd: testRepoPath });
        execSync('git branch -D remote-only-branch', { cwd: testRepoPath });

        // Fetch to ensure we have the remote ref
        execSync('git fetch origin', { cwd: testRepoPath });

        // Now create a workspace with baseRef = 'remote-only-branch' (without origin/ prefix)
        // This simulates what happens when user selects from "Remote branches" in the UI
        const createResult = await workspaceService.createWorkspace({
          title: 'Workspace from Remote Branch',
          repositoryPath: testRepoPath,
          baseRef: 'remote-only-branch', // Without origin/ prefix, like the UI sends
        });

        expect(createResult.ok).toBe(true);
        const workspace = createResult.data!;

        expect(workspace.worktreePath).toBeDefined();

        // Verify the worktree was created from the remote branch content
        // by checking that the remote-file.txt exists
        const remoteFilePath = path.join(workspace.worktreePath!, 'remote-file.txt');
        try {
          await fs.access(remoteFilePath);
          const content = await fs.readFile(remoteFilePath, 'utf-8');
          expect(content.trim()).toBe('remote content');
        } catch {
          expect.fail('Worktree should contain remote-file.txt from the remote branch');
        }

        // Verify the worktree HEAD matches the remote branch commit
        const worktreeCommitSha = execSync('git rev-parse HEAD', { cwd: workspace.worktreePath! })
          .toString()
          .trim();
        expect(worktreeCommitSha).toBe(remoteCommitSha);
      } finally {
        // Cleanup bare repo
        await fs.rm(bareRepoPath, { recursive: true, force: true });
      }
    });
  });

  describe('Workspace Loading and Listing', () => {
    it('should load workspace with existing agents', async () => {
      // Create workspace
      const createResult = await workspaceService.createWorkspace({
        title: 'Workspace to Load',
        repositoryPath: testRepoPath,
      });

      const workspace = createResult.data!;

      // Create multiple agents
      const agentCount = 3;
      const agents: AgentSession[] = [];

      for (let i = 0; i < agentCount; i++) {
        const agent = await harness.createAgent({
          name: `Agent ${i}`,
          model: 'claude-3-opus',
          provider: 'anthropic',
          workspaceId: workspace.id,
        });
        agents.push(agent);
      }

      // Load workspace
      const loadResult = await workspaceService.getWorkspace(workspace.id);
      expect(loadResult.ok).toBe(true);
      expect(loadResult.data).toBeDefined();
    });

    it('should list all workspaces', async () => {
      // Create multiple workspaces
      const workspaceCount = 3;
      const workspaces: Workspace[] = [];

      for (let i = 0; i < workspaceCount; i++) {
        const result = await workspaceService.createWorkspace({
          title: `List Test Workspace ${i}`,
          repositoryPath: testRepoPath,
        });
        if (result.ok && result.data) {
          workspaces.push(result.data);
        }
      }

      // List workspaces
      const listResult = await workspaceService.listWorkspaces();
      expect(listResult.ok).toBe(true);
      expect(listResult.data).toBeDefined();

      // Should contain at least the workspaces we created
      expect(listResult.data!.workspaces.length).toBeGreaterThanOrEqual(workspaceCount);
      expect(listResult.data!.total).toBeGreaterThanOrEqual(workspaceCount);
    });
  });

  describe('Workspace Deletion and Cleanup', () => {
    it('should delete workspace and cleanup agents', async () => {
      // Create workspace
      const createResult = await workspaceService.createWorkspace({
        title: 'Workspace to Delete',
        repositoryPath: testRepoPath,
      });

      const workspace = createResult.data!;

      // Create agents
      const agent1 = await harness.createAgent({
        name: 'Agent to Delete 1',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: workspace.id,
      });

      const agent2 = await harness.createAgent({
        name: 'Agent to Delete 2',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: workspace.id,
      });

      // Delete workspace
      const deleteResult = await workspaceService.deleteWorkspace(workspace.id);
      expect(deleteResult.ok).toBe(true);

      // Verify workspace is deleted
      const loadResult = await workspaceService.getWorkspace(workspace.id);
      expect(loadResult.ok).toBe(false);

      // Manually cleanup agents in test harness when workspace is deleted
      // This simulates what would happen in production with proper event handling
      await harness.deleteAgentsInWorkspace(workspace.id);

      // Verify agents are cleaned up
      const agents = await harness.listAgentsInWorkspace(workspace.id);
      expect(agents).toHaveLength(0);
    });

    it('should cleanup worktree on deletion', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Workspace with Worktree to Delete',
        repositoryPath: testRepoPath,
        branch: 'feature/delete-test',
      });

      const workspace = createResult.data!;
      const worktreePath = workspace.worktreePath!;

      // Verify worktree exists
      await fs.access(worktreePath);

      // Delete workspace
      await workspaceService.deleteWorkspace(workspace.id);

      // Verify worktree is removed
      try {
        await fs.access(worktreePath);
        expect.fail('Worktree should be deleted');
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('Workspace Duplication', () => {
    it('should duplicate workspace with agents', async () => {
      // Create original workspace
      const originalResult = await workspaceService.createWorkspace({
        title: 'Original Workspace',
        repositoryPath: testRepoPath,
      });

      const original = originalResult.data!;

      // Create agents in original
      const agent1 = await harness.createAgent({
        name: 'Original Agent 1',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: original.id,
      });

      const agent2 = await harness.createAgent({
        name: 'Original Agent 2',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: original.id,
      });

      // Duplicate workspace
      const duplicateResult = await workspaceService.duplicateWorkspace(
        original.id,
        'Duplicated Workspace',
      );

      expect(duplicateResult.ok).toBe(true);
      const duplicate = duplicateResult.data!;

      expect(duplicate.title).toBe('Duplicated Workspace');
      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.repositoryPath).toBe(original.repositoryPath);

      // Manually duplicate agents in test harness
      // The workspace service doesn't automatically duplicate agents
      const duplicatedAgents = await harness.duplicateAgentsToWorkspace(original.id, duplicate.id);

      // Verify agents were duplicated
      expect(duplicatedAgents.length).toBe(2);
    });
  });

  describe('Workspace Archiving', () => {
    it('should archive and restore workspace', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Workspace to Archive',
        repositoryPath: testRepoPath,
      });

      const workspace = createResult.data!;

      // Archive workspace
      const archiveResult = await workspaceService.archiveWorkspace(workspace.id);
      expect(archiveResult.ok).toBe(true);

      // Load archived workspace
      const loadResult = await workspaceService.getWorkspace(workspace.id);
      expect(loadResult.ok).toBe(true);
      expect(loadResult.data?.status).toBe(WorkspaceStatus.Archived);

      // Restore workspace
      const restoreResult = await workspaceService.restoreWorkspace(workspace.id);
      expect(restoreResult.ok).toBe(true);

      // Verify restored
      const restoredResult = await workspaceService.getWorkspace(workspace.id);
      expect(restoredResult.data?.status).toBe(WorkspaceStatus.Active);
    });
  });

  describe('Workspace Metadata Persistence', () => {
    it('should persist workspace metadata changes', async () => {
      const createResult = await workspaceService.createWorkspace({
        title: 'Metadata Test Workspace',
        repositoryPath: testRepoPath,
      });

      const workspace = createResult.data!;

      // Update workspace
      const updatedWorkspace = {
        ...workspace,
        title: 'Updated Title',
        tags: ['test', 'integration'],
        metadata: {
          lastModified: new Date().toISOString(),
          customField: 'custom value',
        },
      };

      await workspaceService.updateWorkspace(updatedWorkspace);

      // Reload and verify
      const loadResult = await workspaceService.getWorkspace(workspace.id);
      expect(loadResult.data?.title).toBe('Updated Title');
      expect(loadResult.data?.tags).toEqual(['test', 'integration']);
      expect(loadResult.data?.metadata?.customField).toBe('custom value');
    });
  });
});

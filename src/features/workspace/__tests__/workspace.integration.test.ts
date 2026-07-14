/**
 * Integration test for workspace current context functionality
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { WorkspaceService } from '../main/workspace.service';
import { FileSystemWorkspaceRepository } from '../main/workspace.repository';
import type { WorkspaceUIContext } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config.js';

// These tests verify the filesystem fallback path for workspace context operations.
// DaemonWorkspaceRepository now uses workspace.getContext/updateContext RPCs (intentd#159, PROTOCOL.md §5.1)
// but falls back to filesystem when the RPCs are unavailable. These tests use FileSystemWorkspaceRepository
// directly to test the fallback implementation.
describe('Workspace Current Context Integration', () => {
  let workspaceService: WorkspaceService;
  let testWorkspaceId: string;

  beforeEach(async () => {
    // New workspace ID for each test
    testWorkspaceId = randomUUID();

    // Use FileSystemWorkspaceRepository directly to test the filesystem path
    const repository = new FileSystemWorkspaceRepository();
    workspaceService = new WorkspaceService(repository);
  });

  afterEach(async () => {
    // Clean up test workspace directory under the configured root
    try {
      await fs.rm(WorkspaceConfig.paths.workspace(testWorkspaceId), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  });

  it('should write and read current context correctly', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'test-file.ts',
      mainContentPath: 'src/test-file.ts',
      lastUpdated: new Date().toISOString(),
    };

    // Update the current context
    const updateResult = await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    expect(updateResult.ok).toBe(true);

    // Verify the file was written
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const fileExists = await fs
      .access(contextPath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // Read and verify the content
    const fileContent = await fs.readFile(contextPath, 'utf-8');
    const parsedContext = JSON.parse(fileContent);

    expect(parsedContext).toEqual(testContext);
  });

  it('should get current context from cache', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'test-note-123',
      lastUpdated: new Date().toISOString(),
    };

    // Update the current context (this populates the cache)
    const updateResult = await workspaceService.updateCurrentContext(testWorkspaceId, testContext);
    expect(updateResult.ok).toBe(true);

    // Get the current context (should come from cache)
    const retrievedContext = await workspaceService.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
  });

  it('should get current context from disk when cache is empty', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'test-file.ts',
      mainContentPath: 'src/test-file.ts',
      lastUpdated: new Date().toISOString(),
    };

    // Update the current context
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Create a new service instance (simulates app restart - cache is empty)
    const repository = new FileSystemWorkspaceRepository();
    const newServiceInstance = new WorkspaceService(repository);

    // Get the current context (should read from disk)
    const retrievedContext = await newServiceInstance.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
  });

  it('should return null when no context exists', async () => {
    // Try to get context for a workspace that has never had context set
    const retrievedContext = await workspaceService.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toBeNull();
  });

  it('should handle different content types', async () => {
    const noteContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'test-note-id',
      lastUpdated: new Date().toISOString(),
    };

    const updateResult = await workspaceService.updateCurrentContext(testWorkspaceId, noteContext);

    expect(updateResult.ok).toBe(true);

    // Verify the content
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const fileContent = await fs.readFile(contextPath, 'utf-8');
    const parsedContext = JSON.parse(fileContent);

    expect(parsedContext.mainContentType).toBe('note');
    expect(parsedContext.mainContentId).toBe('test-note-id');
    expect(parsedContext.mainContentPath).toBeUndefined();
  });

  it('should handle empty content type', async () => {
    const emptyContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'empty',
      lastUpdated: new Date().toISOString(),
    };

    const updateResult = await workspaceService.updateCurrentContext(testWorkspaceId, emptyContext);

    expect(updateResult.ok).toBe(true);

    // Verify the content
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const fileContent = await fs.readFile(contextPath, 'utf-8');
    const parsedContext = JSON.parse(fileContent);

    expect(parsedContext.mainContentType).toBe('empty');
    expect(parsedContext.mainContentId).toBeUndefined();
    expect(parsedContext.mainContentPath).toBeUndefined();
  });

  it('should handle diff context with git information', async () => {
    const diffContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'diff',
      mainContentId: 'src/test.ts',
      mainContentPath: 'src/test.ts',
      diffInfo: {
        additions: 15,
        deletions: 3,
        isStaged: false,
        gitStatus: 'modified',
        changeType: 'modified',
      },
      lastUpdated: new Date().toISOString(),
    };

    const updateResult = await workspaceService.updateCurrentContext(testWorkspaceId, diffContext);

    expect(updateResult.ok).toBe(true);

    // Verify the content was written correctly
    const diffContextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const diffFileContent = await fs.readFile(diffContextPath, 'utf-8');
    const diffParsedContext = JSON.parse(diffFileContent);

    expect(diffParsedContext.mainContentType).toBe('diff');
    expect(diffParsedContext.mainContentId).toBe('src/test.ts');
    expect(diffParsedContext.mainContentPath).toBe('src/test.ts');
    expect(diffParsedContext.diffInfo).toBeDefined();
    expect(diffParsedContext.diffInfo.additions).toBe(15);
    expect(diffParsedContext.diffInfo.deletions).toBe(3);
    expect(diffParsedContext.diffInfo.isStaged).toBe(false);
    expect(diffParsedContext.diffInfo.gitStatus).toBe('modified');
    expect(diffParsedContext.diffInfo.changeType).toBe('modified');

    // Verify we can read it back
    const retrievedContext = await workspaceService.getCurrentContext(testWorkspaceId);
    expect(retrievedContext).toBeDefined();
    expect(retrievedContext?.diffInfo).toBeDefined();
    expect(retrievedContext?.diffInfo?.additions).toBe(15);
    expect(retrievedContext?.diffInfo?.deletions).toBe(3);
  });

  it("should create workspace directory if it doesn't exist", async () => {
    const nonExistentWorkspaceId = randomUUID();
    const testContext: WorkspaceUIContext = {
      workspaceId: nonExistentWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'test.ts',
      lastUpdated: new Date().toISOString(),
    };

    const updateResult = await workspaceService.updateCurrentContext(
      nonExistentWorkspaceId,
      testContext,
    );

    expect(updateResult.ok).toBe(true);

    // Verify the directory and file were created
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(nonExistentWorkspaceId),
      'current-context.json',
    );

    const fileExists = await fs
      .access(contextPath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    // Clean up
    await fs.rm(WorkspaceConfig.paths.workspace(nonExistentWorkspaceId), {
      recursive: true,
      force: true,
    });
  });

  it("should skip writing if context hasn't changed (deduplication)", async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'test-file.ts',
      mainContentPath: 'src/test-file.ts',
      lastUpdated: new Date().toISOString(),
    };

    // First update
    const updateResult1 = await workspaceService.updateCurrentContext(testWorkspaceId, testContext);
    expect(updateResult1.ok).toBe(true);

    // Get the file modification time
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const stat1 = await fs.stat(contextPath);
    const mtime1 = stat1.mtimeMs;

    // Wait a bit to ensure time difference would be detectable
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second update with same context (different timestamp)
    const testContext2: WorkspaceUIContext = {
      ...testContext,
      lastUpdated: new Date().toISOString(),
    };

    const updateResult2 = await workspaceService.updateCurrentContext(
      testWorkspaceId,
      testContext2,
    );
    expect(updateResult2.ok).toBe(true);

    // Check that file was NOT modified (deduplication worked)
    const stat2 = await fs.stat(contextPath);
    const mtime2 = stat2.mtimeMs;

    // The modification times should be the same (file wasn't rewritten)
    expect(mtime2).toBe(mtime1);
  });

  it('should write if context has changed', async () => {
    const testContext1: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'test-file.ts',
      mainContentPath: 'src/test-file.ts',
      lastUpdated: new Date().toISOString(),
    };

    // First update
    const updateResult1 = await workspaceService.updateCurrentContext(
      testWorkspaceId,
      testContext1,
    );
    expect(updateResult1.ok).toBe(true);

    // Get the file modification time
    const contextPath = path.join(
      WorkspaceConfig.paths.metadata(testWorkspaceId),
      'current-context.json',
    );
    const stat1 = await fs.stat(contextPath);
    const mtime1 = stat1.mtimeMs;

    // Wait a bit to ensure time difference would be detectable
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second update with different context
    const testContext2: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'different-note-id',
      lastUpdated: new Date().toISOString(),
    };

    const updateResult2 = await workspaceService.updateCurrentContext(
      testWorkspaceId,
      testContext2,
    );
    expect(updateResult2.ok).toBe(true);

    // Check that file WAS modified
    const stat2 = await fs.stat(contextPath);
    const mtime2 = stat2.mtimeMs;

    // The modification times should be different (file was rewritten)
    expect(mtime2).toBeGreaterThan(mtime1);

    // Verify the new content
    const fileContent = await fs.readFile(contextPath, 'utf-8');
    const parsedContext = JSON.parse(fileContent);
    expect(parsedContext.mainContentType).toBe('note');
    expect(parsedContext.mainContentId).toBe('different-note-id');
  });
});

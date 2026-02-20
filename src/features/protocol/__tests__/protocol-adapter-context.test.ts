/**
 * Integration test for protocol adapter getCurrentContext functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ProtocolAdapter } from '../protocol-adapter';
import { WorkspaceService } from '../../workspace/main/workspace.service';
import type { WorkspaceUIContext } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import { promises as fs } from 'fs';

describe('ProtocolAdapter getCurrentContext', () => {
  let protocolAdapter: ProtocolAdapter;
  let workspaceService: WorkspaceService;
  let testWorkspaceId: string;

  beforeEach(async () => {
    // New workspace ID for each test
    testWorkspaceId = randomUUID();

    // Create service and adapter instances
    workspaceService = new WorkspaceService();
    protocolAdapter = new ProtocolAdapter(workspaceService);
  });

  afterEach(async () => {
    // Clean up test workspace directory
    try {
      await fs.rm(WorkspaceConfig.paths.workspace(testWorkspaceId), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  });

  it('should return null when no context exists', async () => {
    const context = await protocolAdapter.getCurrentContext(testWorkspaceId);
    expect(context).toBeNull();
  });

  it('should return context after it has been set', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'test-note-123',
      lastUpdated: new Date().toISOString(),
    };

    // Set context via workspace service
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Get context via protocol adapter
    const retrievedContext = await protocolAdapter.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
  });

  it('should return context with file information', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'src/test.ts',
      mainContentPath: 'src/test.ts',
      lastUpdated: new Date().toISOString(),
    };

    // Set context
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Get context via protocol adapter
    const retrievedContext = await protocolAdapter.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
    expect(retrievedContext?.mainContentType).toBe('file');
    expect(retrievedContext?.mainContentId).toBe('src/test.ts');
    expect(retrievedContext?.mainContentPath).toBe('src/test.ts');
  });

  it('should return context with diff information', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'diff',
      mainContentId: 'src/test.ts',
      mainContentPath: 'src/test.ts',
      diffInfo: {
        additions: 10,
        deletions: 5,
        isStaged: false,
        gitStatus: 'modified',
        changeType: 'modified',
      },
      lastUpdated: new Date().toISOString(),
    };

    // Set context
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Get context via protocol adapter
    const retrievedContext = await protocolAdapter.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
    expect(retrievedContext?.mainContentType).toBe('diff');
    expect(retrievedContext?.diffInfo).toBeDefined();
    expect(retrievedContext?.diffInfo?.additions).toBe(10);
    expect(retrievedContext?.diffInfo?.deletions).toBe(5);
    expect(retrievedContext?.diffInfo?.isStaged).toBe(false);
    expect(retrievedContext?.diffInfo?.gitStatus).toBe('modified');
    expect(retrievedContext?.diffInfo?.changeType).toBe('modified');
  });

  it('should return cached context on subsequent calls', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'test-note-456',
      lastUpdated: new Date().toISOString(),
    };

    // Set context
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Get context multiple times (should use cache)
    const context1 = await protocolAdapter.getCurrentContext(testWorkspaceId);
    const context2 = await protocolAdapter.getCurrentContext(testWorkspaceId);

    expect(context1).toEqual(testContext);
    expect(context2).toEqual(testContext);
    expect(context1).toEqual(context2);
  });

  it('should read from disk when cache is empty', async () => {
    const testContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'diff',
      mainContentId: 'diff-123',
      lastUpdated: new Date().toISOString(),
    };

    // Set context with first adapter instance
    await workspaceService.updateCurrentContext(testWorkspaceId, testContext);

    // Create new adapter instance (simulates app restart - cache is empty)
    const newWorkspaceService = new WorkspaceService();
    const newProtocolAdapter = new ProtocolAdapter(newWorkspaceService);

    // Get context via new adapter (should read from disk)
    const retrievedContext = await newProtocolAdapter.getCurrentContext(testWorkspaceId);

    expect(retrievedContext).toEqual(testContext);
  });

  it('should handle context updates correctly', async () => {
    const initialContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'note',
      mainContentId: 'note-1',
      lastUpdated: new Date().toISOString(),
    };

    // Set initial context
    await workspaceService.updateCurrentContext(testWorkspaceId, initialContext);

    // Verify initial context
    let context = await protocolAdapter.getCurrentContext(testWorkspaceId);
    expect(context?.mainContentId).toBe('note-1');

    // Update to different content
    const updatedContext: WorkspaceUIContext = {
      workspaceId: testWorkspaceId,
      mainContentType: 'file',
      mainContentId: 'src/app.ts',
      mainContentPath: 'src/app.ts',
      lastUpdated: new Date().toISOString(),
    };

    await workspaceService.updateCurrentContext(testWorkspaceId, updatedContext);

    // Verify updated context
    context = await protocolAdapter.getCurrentContext(testWorkspaceId);
    expect(context?.mainContentType).toBe('file');
    expect(context?.mainContentId).toBe('src/app.ts');
  });
});

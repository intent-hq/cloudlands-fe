/**
 * Test for workspace context tracking in the unified state manager
 *
 * This test verifies that the current context is updated when the user
 * navigates between notes, files, and diffs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUnifiedWorkspaceState } from '../workspace-unified-state.svelte';
import type { Workspace } from '../../../shared/types';

// Mock the workspace store - must be hoisted
vi.mock('../workspace.store.svelte', () => ({
  workspaceStore: {
    updateCurrentContext: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

// Import the mocked module to get reference to the mock function
import { workspaceStore } from '../workspace.store.svelte';
const mockUpdateCurrentContext = workspaceStore.updateCurrentContext as ReturnType<typeof vi.fn>;

describe('Workspace Context Tracking', () => {
  let workspaceState: ReturnType<typeof createUnifiedWorkspaceState>;
  const testWorkspaceId = 'test-workspace-123';
  const mockWorkspace: Workspace = {
    id: testWorkspaceId,
    title: 'Test Workspace',
    path: '/test/path',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'ready' as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockUpdateCurrentContext.mockClear();

    // Create a new workspace state
    workspaceState = createUnifiedWorkspaceState(testWorkspaceId);

    // Set the workspace data
    workspaceState.updateState({
      workspaceData: mockWorkspace,
      workspace: { id: testWorkspaceId, status: 'ready' },
    });
  });

  afterEach(async () => {
    // Clean up
    await workspaceState.dispose();
  });

  it('should update context when opening a note', async () => {
    // Open a note
    workspaceState.setMainPanel('notes', { selectedNoteId: 'test-note-123' });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify updateCurrentContext was called
    expect(mockUpdateCurrentContext).toHaveBeenCalledWith(
      testWorkspaceId,
      expect.objectContaining({
        workspaceId: testWorkspaceId,
        mainContentType: 'notes',
        mainContentId: 'test-note-123',
      }),
    );
  });

  it('should update context when opening a file', async () => {
    // Open a file
    workspaceState.setMainPanel('file', { selectedFile: 'src/test.ts' });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify updateCurrentContext was called
    expect(mockUpdateCurrentContext).toHaveBeenCalledWith(
      testWorkspaceId,
      expect.objectContaining({
        workspaceId: testWorkspaceId,
        mainContentType: 'file',
        mainContentId: 'src/test.ts',
        mainContentPath: 'src/test.ts',
      }),
    );
  });

  it('should update context when opening a diff', async () => {
    // Open a diff
    workspaceState.setMainPanel('diff', { selectedFile: 'src/modified.ts' });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify updateCurrentContext was called with diffInfo
    expect(mockUpdateCurrentContext).toHaveBeenCalledWith(
      testWorkspaceId,
      expect.objectContaining({
        workspaceId: testWorkspaceId,
        mainContentType: 'diff',
        mainContentId: 'src/modified.ts',
        mainContentPath: 'src/modified.ts',
        diffInfo: expect.objectContaining({
          additions: expect.any(Number),
          deletions: expect.any(Number),
          isStaged: expect.any(Boolean),
        }),
      }),
    );
  });

  it('should include file path in context for diffs', async () => {
    // Open a diff with a specific file path
    const testFilePath = 'src/components/MyComponent.tsx';
    workspaceState.setMainPanel('diff', { selectedFile: testFilePath });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the last call to updateCurrentContext
    const calls = mockUpdateCurrentContext.mock.calls;
    const lastCall = calls[calls.length - 1];
    const context = lastCall[1];

    // Verify the file path is included
    expect(context.mainContentPath).toBe(testFilePath);
    expect(context.mainContentId).toBe(testFilePath);
    expect(context.mainContentType).toBe('diff');
  });

  it('should handle file-tracking-diff panel type', async () => {
    // Open a file-tracking-diff with tracked change info
    const testFilePath = 'src/utils/helper.ts';
    const mockTrackedChange = {
      file: testFilePath,
      stage: 'staged',
      gitStatus: 'modified',
      changeType: 'modified',
      stats: {
        additions: 10,
        deletions: 5,
      },
    };

    workspaceState.setMainPanel('file-tracking-diff', {
      selectedFile: testFilePath,
      selectedTrackedChange: mockTrackedChange,
    });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the last call to updateCurrentContext
    const calls = mockUpdateCurrentContext.mock.calls;
    const lastCall = calls[calls.length - 1];
    const context = lastCall[1];

    // Verify the context is correct
    expect(context.mainContentType).toBe('diff'); // Should be normalized to "diff"
    expect(context.mainContentPath).toBe(testFilePath);
    expect(context.mainContentId).toBe(testFilePath);
    expect(context.diffInfo).toEqual({
      additions: 10,
      deletions: 5,
      isStaged: true,
      gitStatus: 'modified',
      changeType: 'modified',
    });
  });

  it('should update context even for new workspaces', async () => {
    // Create a new state - workspace ID is always set from constructor
    const newState = createUnifiedWorkspaceState('new-workspace');

    // Clear the mock to track only new calls
    mockUpdateCurrentContext.mockClear();

    // Open a note
    newState.setMainPanel('notes', { selectedNoteId: 'test-note' });

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Clean up
    await newState.dispose();

    // Verify updateCurrentContext was called with the workspace ID
    expect(mockUpdateCurrentContext).toHaveBeenCalledWith(
      'new-workspace',
      expect.objectContaining({
        workspaceId: 'new-workspace',
        mainContentType: 'notes',
        mainContentId: 'test-note',
      }),
    );
  });
});

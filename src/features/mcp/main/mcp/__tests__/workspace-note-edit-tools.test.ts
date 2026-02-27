/**
 * Tests for Workspace Note Edit Tools
 * Verifies add_to_note (formerly append_to_note) safely adds content without replacing existing content
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AddToNoteTool, AppendToNoteTool } from '../workspace-note-edit-tools';
import type { ToolCall } from '../protocol';

// Mock electron BrowserWindow
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp/test'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    isReady: vi.fn(() => true),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock provenance context manager
vi.mock('$features/workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: vi.fn(() => ({
    getCurrentContext: vi.fn(() => null),
    createAgentContext: vi.fn(() => 'mock-context-id'),
    popContext: vi.fn(),
  })),
}));

describe('AddToNoteTool', () => {
  let mockWorkspaceManager: any;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceManager = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
    };
  });

  it('should add content to an existing note', async () => {
    const tool = new AddToNoteTool(mockWorkspaceManager, workspaceId);

    const existingNote = {
      id: 'spec',
      title: 'Specification',
      content: '# Existing Content\n\nThis is the original spec.',
    };

    const updatedNote = {
      ...existingNote,
      content: `${existingNote.content}\n\n## New Section\n\nAppended content here.`,
    };

    mockWorkspaceManager.getNote.mockResolvedValue(existingNote);
    mockWorkspaceManager.updateNote.mockResolvedValue(updatedNote);

    const call: ToolCall = {
      name: 'add_to_note',
      arguments: {
        noteId: 'spec',
        content: 'Appended content here.',
        heading: '## New Section',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('Content added to note');
    expect(mockWorkspaceManager.getNote).toHaveBeenCalledWith(workspaceId, 'spec');
    expect(mockWorkspaceManager.updateNote).toHaveBeenCalledWith(
      workspaceId,
      'spec',
      expect.objectContaining({
        content: expect.stringContaining('# Existing Content'),
      }),
    );
    expect(mockWorkspaceManager.updateNote).toHaveBeenCalledWith(
      workspaceId,
      'spec',
      expect.objectContaining({
        content: expect.stringContaining('## New Section'),
      }),
    );
  });

  it('should add content without heading when heading is not provided', async () => {
    const tool = new AddToNoteTool(mockWorkspaceManager, workspaceId);

    const existingNote = {
      id: 'note-1',
      title: 'Test Note',
      content: 'Original content.',
    };

    mockWorkspaceManager.getNote.mockResolvedValue(existingNote);
    mockWorkspaceManager.updateNote.mockResolvedValue({
      ...existingNote,
      content: 'Original content.\n\nNew content without heading.',
    });

    const call: ToolCall = {
      name: 'add_to_note',
      arguments: {
        noteId: 'note-1',
        content: 'New content without heading.',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(false);
    expect(mockWorkspaceManager.updateNote).toHaveBeenCalledWith(
      workspaceId,
      'note-1',
      expect.objectContaining({
        content: 'Original content.\n\nNew content without heading.',
      }),
    );
  });

  it('should return error when note is not found', async () => {
    const tool = new AddToNoteTool(mockWorkspaceManager, workspaceId);

    mockWorkspaceManager.getNote.mockResolvedValue(null);

    const call: ToolCall = {
      name: 'add_to_note',
      arguments: {
        noteId: 'non-existent',
        content: 'Some content',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Note not found');
  });

  it('should return error when noteId is missing', async () => {
    const tool = new AddToNoteTool(mockWorkspaceManager, workspaceId);

    const call: ToolCall = {
      name: 'add_to_note',
      arguments: {
        content: 'Some content',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Note ID is required');
  });

  it('should return error when content is missing', async () => {
    const tool = new AddToNoteTool(mockWorkspaceManager, workspaceId);

    const call: ToolCall = {
      name: 'add_to_note',
      arguments: {
        noteId: 'spec',
      },
    };

    const result = await tool.execute(call);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Content is required');
  });

  it('AppendToNoteTool alias works for backward compatibility', () => {
    // Verify the alias points to the same class
    expect(AppendToNoteTool).toBe(AddToNoteTool);
  });
});

describe('EditNoteTool', () => {
  let mockWorkspaceManager: any;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceManager = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
    };
  });

  it('should reject empty old_text to prevent accidental content injection', async () => {
    const { EditNoteTool } = await import('../workspace-note-edit-tools');
    const tool = new EditNoteTool(mockWorkspaceManager, workspaceId);

    const existingNote = {
      id: 'spec',
      title: 'Specification',
      content: 'Original content here.',
    };

    mockWorkspaceManager.getNote.mockResolvedValue(existingNote);

    const call = {
      name: 'edit_note',
      arguments: {
        noteId: 'spec',
        old_text: '', // Empty string should be rejected
        new_text: 'Injected content',
      },
    };

    const result = await tool.execute(call as any);

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('old_text is required and cannot be empty');
    expect(mockWorkspaceManager.updateNote).not.toHaveBeenCalled();
  });
});

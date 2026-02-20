/**
 * Unit tests for the MCP SetNoteContentTool (formerly UpdateNoteTool).
 *
 * These tests are intentionally isolated from the broader task-tools test suite so
 * that module-level mocks (for notes.service and task-block parsing) do not leak
 * into tests that require the real NotesService implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// The tool imports these modules at runtime (some statically, some dynamically).
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp/test'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('$features/workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: () => ({
    getCurrentContext: vi.fn().mockReturnValue(undefined),
    createAgentContext: vi.fn().mockReturnValue('ctx-1'),
    popContext: vi.fn(),
  }),
}));

vi.mock('$features/notes/utils/task-block-parser', () => ({
  hasTaskBlocks: vi.fn(),
}));

vi.mock('$features/notes/main/notes.service', () => ({
  notesService: { convertTaskBlocks: vi.fn() },
}));

import { SetNoteContentTool, UpdateNoteTool } from '../main/mcp/workspace-note-tools';
import { WorkspaceId } from '$shared/types/branded-ids';
import { hasTaskBlocks } from '$features/notes/utils/task-block-parser';
import { notesService } from '$features/notes/main/notes.service';

describe('SetNoteContentTool (task-block auto-conversion)', () => {
  let workspaceId: WorkspaceId;
  let workspaceManager: { updateNote: ReturnType<typeof vi.fn>; getNote: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceId = WorkspaceId(uuidv4());
    workspaceManager = {
      updateNote: vi.fn(),
      getNote: vi.fn().mockResolvedValue(null), // Note doesn't exist yet
    };
  });

  it('auto-converts task blocks when setting spec content (noteId="spec")', async () => {
    workspaceManager.updateNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: '```task\n# Task\nDesc\n```',
      tags: [],
    });

    (hasTaskBlocks as any).mockReturnValue(true);
    (notesService.convertTaskBlocks as any).mockResolvedValue({
      ok: true,
      data: { convertedCount: 1, createdNoteIds: ['t1'] },
    });

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: { noteId: 'spec', content: '```task\n# Task\nDesc\n```' },
    } as any);

    const text = (result?.content?.[0] as any)?.text;

    expect(result.isError).toBe(false);
    expect(hasTaskBlocks as any).toHaveBeenCalled();
    expect(notesService.convertTaskBlocks as any).toHaveBeenCalledWith(
      WorkspaceId(workspaceId),
      'spec',
    );
    expect(text).toContain('Note content replaced: spec');
    expect(text).toContain('Auto-converted 1');
  });

  it('auto-converts task blocks for non-spec notes', async () => {
    workspaceManager.updateNote.mockResolvedValue({
      id: 'n1',
      title: 'Regular Note',
      content: '```task\n# Task\nDesc\n```',
      tags: [],
    });

    (hasTaskBlocks as any).mockReturnValue(true);
    (notesService.convertTaskBlocks as any).mockResolvedValue({
      ok: true,
      data: { convertedCount: 2, createdNoteIds: ['t1', 't2'] },
    });

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: { noteId: 'n1', content: '```task\n# Task\nDesc\n```' },
    } as any);

    const text = (result?.content?.[0] as any)?.text;

    expect(notesService.convertTaskBlocks as any).toHaveBeenCalledWith(
      WorkspaceId(workspaceId),
      'n1',
    );
    expect(result.isError).toBe(false);
    expect(text).toContain('Auto-converted 2');
  });

  it('UpdateNoteTool alias works for backward compatibility', () => {
    // Verify the alias points to the same class
    expect(UpdateNoteTool).toBe(SetNoteContentTool);
  });
});

describe('SetNoteContentTool (content reduction safety check)', () => {
  let workspaceId: WorkspaceId;
  let workspaceManager: { updateNote: ReturnType<typeof vi.fn>; getNote: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceId = WorkspaceId(uuidv4());
    workspaceManager = {
      updateNote: vi.fn(),
      getNote: vi.fn(),
    };
  });

  it('requires confirmation when content is reduced by more than 50%', async () => {
    // Simulate existing long content
    workspaceManager.getNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'A'.repeat(1000), // 1000 chars of existing content
    });

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: {
        noteId: 'spec',
        content: 'Short replacement', // Only 17 chars
      },
    } as any);

    const text = (result?.content?.[0] as any)?.text;

    // Should fail with confirmation request
    expect(result.isError).toBe(true);
    expect(text).toContain('CONTENT REDUCTION DETECTED');
    expect(text).toContain('confirm_replacement="true"');
    expect(workspaceManager.updateNote).not.toHaveBeenCalled();
  });

  it('allows replacement when confirm_replacement is set', async () => {
    // Simulate existing long content
    workspaceManager.getNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'A'.repeat(1000), // 1000 chars of existing content
    });

    workspaceManager.updateNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'Short replacement',
      tags: [],
    });

    (hasTaskBlocks as any).mockReturnValue(false);

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: {
        noteId: 'spec',
        content: 'Short replacement',
        confirm_replacement: 'true',
      },
    } as any);

    const text = (result?.content?.[0] as any)?.text;

    // Should succeed with confirmation
    expect(result.isError).toBe(false);
    expect(text).toContain('Note content replaced: spec');
    expect(workspaceManager.updateNote).toHaveBeenCalled();
  });

  it('allows replacement without confirmation when content is similar length', async () => {
    // Simulate existing content
    workspaceManager.getNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'Original content here', // 21 chars
    });

    workspaceManager.updateNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'Updated content here!', // 21 chars (similar length)
      tags: [],
    });

    (hasTaskBlocks as any).mockReturnValue(false);

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: {
        noteId: 'spec',
        content: 'Updated content here!',
      },
    } as any);

    // Should succeed without confirmation
    expect(result.isError).toBe(false);
    expect(workspaceManager.updateNote).toHaveBeenCalled();
  });

  it('requires content parameter', async () => {
    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: {
        noteId: 'spec',
      },
    } as any);

    expect(result.isError).toBe(true);
    expect((result?.content?.[0] as any)?.text).toContain('Content is required');
  });

  it('requires confirmation when content is empty string (100% reduction)', async () => {
    // Simulate existing content
    workspaceManager.getNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: 'Existing content that should not be deleted without confirmation',
    });

    const tool = new SetNoteContentTool(workspaceManager, workspaceId);
    const result = await tool.execute({
      arguments: {
        noteId: 'spec',
        content: '', // Empty string - 100% reduction
      },
    } as any);

    const text = (result?.content?.[0] as any)?.text;

    // Should fail with confirmation request
    expect(result.isError).toBe(true);
    expect(text).toContain('CONTENT REDUCTION DETECTED');
    expect(text).toContain('confirm_replacement="true"');
    expect(workspaceManager.updateNote).not.toHaveBeenCalled();
  });
});

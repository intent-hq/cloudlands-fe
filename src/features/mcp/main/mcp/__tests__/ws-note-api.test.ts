/**
 * Tests for note operations through the WorkspaceJsApiTool.
 * Ported from the deleted update-note-tool.test.ts and workspace-note-edit-tools.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron before any imports
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
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
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
  hasTaskBlocks: vi.fn().mockReturnValue(false),
}));

vi.mock('$features/notes/main/notes.service', () => ({
  notesService: { convertTaskBlocks: vi.fn() },
}));

vi.mock('$features/system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

// Mock workspace service to avoid import chain issues
vi.mock('$features/workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
  },
}));

vi.mock('$features/agent/main/agent-backend-handler.service', () => ({
  agentBackendHandler: { createAgentSession: vi.fn() },
  AgentBackendHandler: { getInstance: () => ({ createAgent: vi.fn() }) },
}));

import { WorkspaceJsApiTool } from '../workspace-js-api-tool';
import { hasTaskBlocks } from '$features/notes/utils/task-block-parser';
import { notesService } from '$features/notes/main/notes.service';

function makeCall(code: string) {
  return { name: 'workspace_api', arguments: { code }, context: {} } as any;
}

function getText(result: any): string {
  return (result.content[0] as any).text;
}

describe('ws.note.setContent — content reduction safety', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('rejects when content is reduced by more than 50%', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'A'.repeat(1000) });

    const result = await tool.execute(
      makeCall('return await ws.note.setContent("spec", "Short replacement")'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('CONTENT REDUCTION DETECTED');
    expect(getText(result)).toContain('confirmReplacement=true');
    expect(mockWM.updateNote).not.toHaveBeenCalled();
  });

  it('allows replacement when confirmReplacement=true', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'A'.repeat(1000) });
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'Short', tags: [] });

    const result = await tool.execute(
      makeCall('return await ws.note.setContent("spec", "Short replacement", true)'),
    );

    expect(result.isError).toBe(false);
    expect(mockWM.updateNote).toHaveBeenCalled();
  });

  it('allows replacement without confirmation when content is similar length', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'Original content here' });
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'Updated content here!', tags: [] });

    const result = await tool.execute(
      makeCall('return await ws.note.setContent("spec", "Updated content here!")'),
    );

    expect(result.isError).toBe(false);
    expect(mockWM.updateNote).toHaveBeenCalled();
  });

  it('rejects empty content (100% reduction)', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: 'Existing content' });

    const result = await tool.execute(
      makeCall('return await ws.note.setContent("spec", "")'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('CONTENT REDUCTION DETECTED');
    expect(mockWM.updateNote).not.toHaveBeenCalled();
  });

  it('requires content parameter', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.setContent("spec")'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Content is required');
  });
});

describe('ws.note.setContent — task-block auto-conversion', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn().mockResolvedValue(null),
      updateNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('auto-converts task blocks in content', async () => {
    const taskContent = '```task\n# Task\nDesc\n```';
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: taskContent, tags: [] });
    (hasTaskBlocks as any).mockReturnValue(true);
    (notesService.convertTaskBlocks as any).mockResolvedValue({
      ok: true,
      data: { convertedCount: 1, createdNoteIds: ['t1'] },
    });

    const result = await tool.execute(
      makeCall(`return await ws.note.setContent("spec", ${JSON.stringify(taskContent)})`),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.convertedCount).toBe(1);
    expect(parsed.createdTaskNoteIds).toEqual(['t1']);
    expect(hasTaskBlocks).toHaveBeenCalled();
  });
});

describe('ws.note.add', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('appends content to existing note', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'n1', title: 'Note', content: 'Original' });
    mockWM.updateNote.mockResolvedValue({ id: 'n1', title: 'Note', content: 'Original\n\nAppended', tags: [] });

    const result = await tool.execute(
      makeCall('return await ws.note.add("n1", { content: "Appended" })'),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.ok).toBe(true);
    expect(parsed.newContent).toContain('Original');
    expect(parsed.newContent).toContain('Appended');
  });

  it('adds content with heading', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'n1', title: 'Note', content: 'Existing' });
    mockWM.updateNote.mockImplementation((_wsId: string, _id: string, opts: any) => ({
      id: 'n1', title: 'Note', content: opts.content, tags: [],
    }));

    const result = await tool.execute(
      makeCall('return await ws.note.add("n1", { content: "Details here", heading: "## Section" })'),
    );

    expect(result.isError).toBe(false);
    // The updateNote call should include the heading in the content
    const updateCall = mockWM.updateNote.mock.calls[0];
    expect(updateCall[2].content).toContain('## Section');
    expect(updateCall[2].content).toContain('Details here');
  });

  it('rejects when note not found', async () => {
    mockWM.getNote.mockResolvedValue(null);

    const result = await tool.execute(
      makeCall('return await ws.note.add("missing", { content: "stuff" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Note not found');
  });

  it('rejects when content is missing', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.add("n1", {})'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Content is required');
  });
});

describe('ws.note.edit', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('rejects empty old text to prevent accidental injection', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.edit("n1", { old: "", new: "injected" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('old is required and cannot be empty');
  });

  it('performs surgical text replacement', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'n1', title: 'Note', content: 'Hello world' });
    mockWM.updateNote.mockImplementation((_wsId: string, _id: string, opts: any) => ({
      id: 'n1', title: 'Note', content: opts.content, tags: [],
    }));

    const result = await tool.execute(
      makeCall('return await ws.note.edit("n1", { old: "world", new: "universe" })'),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.ok).toBe(true);
    expect(parsed.newContent).toBe('Hello universe');
  });

  it('rejects when old text is not found in note', async () => {
    mockWM.getNote.mockResolvedValue({ id: 'n1', title: 'Note', content: 'Hello world' });

    const result = await tool.execute(
      makeCall('return await ws.note.edit("n1", { old: "nonexistent", new: "replacement" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Text not found in note');
  });

  it('rejects when note not found', async () => {
    mockWM.getNote.mockResolvedValue(null);

    const result = await tool.execute(
      makeCall('return await ws.note.edit("missing", { old: "x", new: "y" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Note not found');
  });
});

describe('ws.note error cases', () => {
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockWM = { getWorkspace: vi.fn().mockResolvedValue(null) };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('rejects setContent without noteId', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.setContent("", "content")'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Note ID is required');
  });

  it('rejects edit without noteId', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.edit("", { old: "x", new: "y" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Note ID is required');
  });

  it('rejects add without noteId', async () => {
    const result = await tool.execute(
      makeCall('return await ws.note.add("", { content: "stuff" })'),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Note ID is required');
  });
});

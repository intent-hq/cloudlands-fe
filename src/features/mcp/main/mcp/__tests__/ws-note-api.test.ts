/**
 * Tests for note operations through the WorkspaceJsApiTool.
 * Ported from the deleted update-note-tool.test.ts and workspace-note-edit-tools.test.ts.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';

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
import { sendToWorkspaceWindows } from '$features/system/main/system.ipc';

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

  it('auto-converts task blocks in content and skips pre-conversion emit', async () => {
    const taskContent = '@@@task\n# Task\nDesc\n@@@';
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: taskContent, tags: [] });
    (hasTaskBlocks as any).mockReturnValue(true);
    (notesService.convertTaskBlocks as any).mockResolvedValue({
      ok: true,
      data: { convertedCount: 1, createdNoteIds: ['t1'], updatedContent: '- [ ] [Task](intent://local/task/t1)' },
    });

    const result = await tool.execute(
      makeCall(`return await ws.note.setContent("spec", ${JSON.stringify(taskContent)})`),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.convertedCount).toBe(1);
    expect(parsed.createdTaskNoteIds).toEqual(['t1']);
    expect(hasTaskBlocks).toHaveBeenCalled();
    // Pre-conversion emit should NOT have been called when task blocks are present
    // (autoConvertTaskBlocks handles its own emit with post-conversion content)
    expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
  });

  it('emits content update immediately when no task blocks', async () => {
    const plainContent = '# Just a note\nNo task blocks here.';
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content: plainContent, tags: [] });
    (hasTaskBlocks as any).mockReturnValue(false);

    const result = await tool.execute(
      makeCall(`return await ws.note.setContent("spec", ${JSON.stringify(plainContent)})`),
    );

    expect(result.isError).toBe(false);
    // When there are no task blocks, sendToWorkspaceWindows should be called for the content update
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'note:updated', expect.objectContaining({
      noteId: 'spec',
      content: plainContent,
    }));
  });

  it('emits fallback content update when task blocks present but conversion finds none', async () => {
    const content = '@@@task\ninvalid block\n@@@';
    mockWM.updateNote.mockResolvedValue({ id: 'spec', title: 'Spec', content, tags: [] });
    (hasTaskBlocks as any).mockReturnValue(true);
    (notesService.convertTaskBlocks as any).mockResolvedValue({
      ok: true,
      data: { convertedCount: 0, createdNoteIds: [], updatedContent: null },
    });

    const result = await tool.execute(
      makeCall(`return await ws.note.setContent("spec", ${JSON.stringify(content)})`),
    );

    expect(result.isError).toBe(false);
    // Fallback: emit should fire because conversion didn't actually convert anything
    expect(sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'note:updated', expect.objectContaining({
      noteId: 'spec',
      content,
    }));
  });
});

describe('ws.note.listTasks', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('returns taskNoteId and backward-compatible linkedTaskNoteId for linked tasks', async () => {
    mockWM.getNote.mockResolvedValue({
      id: 'spec',
      title: 'Spec',
      content: '- [ ] [Fix it](intent://local/task/abc-123)\n- [/] Plain task',
      tags: [],
    });

    const result = await tool.execute(
      makeCall('return await ws.note.listTasks("spec")'),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed).toEqual([
      {
        lineNumber: 1,
        text: 'Fix it',
        status: 'todo',
        taskNoteId: 'abc-123',
        linkedTaskNoteId: 'abc-123',
      },
      {
        lineNumber: 2,
        text: 'Plain task',
        status: 'in-progress',
        taskNoteId: null,
        linkedTaskNoteId: null,
      },
    ]);
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

describe('toFrontendNote — contentType and visibility defaults', () => {
  let mockWM: any;
  let tool: WorkspaceJsApiTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      getNote: vi.fn(),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
    tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
  });

  it('includes contentType defaulting to markdown', async () => {
    const noteData = { id: 'n1', title: 'Test', content: 'body', tags: [], created_at: '2024-01-01', updated_at: '2024-01-01' };
    mockWM.createNote.mockResolvedValue(noteData);

    await tool.execute(makeCall('return await ws.note.create("Test", "body")'));

    const emitCall = (sendToWorkspaceWindows as any).mock.calls.find(
      (c: any[]) => c[1] === 'note:created',
    );
    expect(emitCall).toBeDefined();
    const emittedNote = emitCall[2].note;
    expect(emittedNote.contentType).toBe('markdown');
  });

  it('includes visibility defaulting to workspace', async () => {
    const noteData = { id: 'n2', title: 'Test2', content: 'body2', tags: [], created_at: '2024-01-01', updated_at: '2024-01-01' };
    mockWM.createNote.mockResolvedValue(noteData);

    await tool.execute(makeCall('return await ws.note.create("Test2", "body2")'));

    const emitCall = (sendToWorkspaceWindows as any).mock.calls.find(
      (c: any[]) => c[1] === 'note:created',
    );
    expect(emitCall).toBeDefined();
    const emittedNote = emitCall[2].note;
    expect(emittedNote.visibility).toBe('workspace');
  });

  it('preserves explicit contentType and visibility from source note', async () => {
    const noteData = {
      id: 'n3', title: 'Code Note', content: 'console.log()', tags: [],
      contentType: 'code', visibility: 'private',
      created_at: '2024-01-01', updated_at: '2024-01-01',
    };
    mockWM.createNote.mockResolvedValue(noteData);

    await tool.execute(makeCall('return await ws.note.create("Code Note", "console.log()")'));

    const emitCall = (sendToWorkspaceWindows as any).mock.calls.find(
      (c: any[]) => c[1] === 'note:created',
    );
    expect(emitCall).toBeDefined();
    const emittedNote = emitCall[2].note;
    expect(emittedNote.contentType).toBe('code');
    expect(emittedNote.visibility).toBe('private');
  });

  it('falls back to content_type field when contentType is absent', async () => {
    const noteData = {
      id: 'n4', title: 'Legacy', content: 'text', tags: [],
      content_type: 'plaintext',
      created_at: '2024-01-01', updated_at: '2024-01-01',
    };
    mockWM.createNote.mockResolvedValue(noteData);

    await tool.execute(makeCall('return await ws.note.create("Legacy", "text")'));

    const emitCall = (sendToWorkspaceWindows as any).mock.calls.find(
      (c: any[]) => c[1] === 'note:created',
    );
    expect(emitCall).toBeDefined();
    const emittedNote = emitCall[2].note;
    expect(emittedNote.contentType).toBe('plaintext');
  });
});

describe('ws.note.create — returned note links', () => {
  let mockWM: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWM = {
      createNote: vi.fn(),
      getWorkspace: vi.fn().mockResolvedValue(null),
    };
  });

  it('returns workspace-qualified intent links for created notes', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test', 'ws-1', mockWM);
    mockWM.createNote.mockResolvedValue({
      id: 'note-123',
      title: 'Created Note',
      content: 'body',
      tags: [],
    });

    const result = await tool.execute(
      makeCall('return await ws.note.create("Created Note", "body")'),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.link).toBe('intent://local/ws-1/note/note-123');
    expect(parsed.markdownLink).toBe('[Created Note](intent://local/ws-1/note/note-123)');
    expect(parsed.link).not.toContain('@note/');
    expect(parsed.markdownLink).not.toContain('@note/');
  });

  it('returns Chief workspace note links that can be parsed from chat', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test', '__chief__', mockWM);
    mockWM.createNote.mockResolvedValue({
      id: 'chief-note-123',
      title: 'Chief Created Note',
      content: 'body',
      tags: ['chief'],
    });

    const result = await tool.execute(
      makeCall('return await ws.note.create("Chief Created Note", "body", ["chief"])'),
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.link).toBe('intent://local/__chief__/note/chief-note-123');
    expect(parsed.markdownLink).toBe(
      '[Chief Created Note](intent://local/__chief__/note/chief-note-123)',
    );
    expect(parsed.link).not.toContain('@note/');
    expect(parsed.markdownLink).not.toContain('@note/');
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

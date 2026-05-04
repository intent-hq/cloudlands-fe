/**
 * Tests for task management MCP tools
 * Phase 1C - Increment 5: MCP Tools for Task Management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// Mock util.promisify BEFORE any imports that use it
vi.mock('util', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: actual,
    promisify:
      (fn: any) =>
        (...args: any[]) =>
          new Promise((resolve, reject) => {
            const callback = (err: any, result: any) => {
              if (err) reject(err);
              else resolve(result);
            };
            fn(...args, callback);
          }),
  };
});

// Mock workspace service to avoid the promisify issue from its imports
vi.mock('../../workspace/main/workspace.service', () => ({
  workspaceService: {
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
  },
}));

// Mock agent-backend-handler to avoid its import chain
vi.mock('../../agent/main/agent-backend-handler.service', () => ({
  agentBackendHandler: {
    createAgentSession: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: 'mock-agent-id',
        status: 'active',
      },
    }),
  },
}));


// Mock Redux store bridge (services now dispatch domain events via mainDispatch)
vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
  getMainStore: vi.fn(),
  getMainState: vi.fn(),
}));

vi.mock('../../../store/main/slices/note-events/note-events-slice', () => ({
  noteCreated: vi.fn((payload: any) => ({ type: 'note-events/noteCreated', payload })),
  noteUpdated: vi.fn((payload: any) => ({ type: 'note-events/noteUpdated', payload })),
  noteDeleted: vi.fn((payload: any) => ({ type: 'note-events/noteDeleted', payload })),
}));

vi.mock('../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn((payload: any) => ({ type: 'workspace-events/emitWorkspaceEvent', payload })),
}));

// Mock system IPC for sendToWorkspaceWindows
vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

// Mock BrowserWindow
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

import { NotesService } from '../../notes/main/notes.service';
import { InMemoryNotesRepository } from '../../notes/main/notes.repository';
import { WorkspaceId, NoteId } from '$shared/types/branded-ids';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

describe('Task Management MCP Tools', () => {
  let notesService: NotesService;
  let repository: InMemoryNotesRepository;
  let workspaceId: WorkspaceId;

  beforeEach(() => {
    repository = new InMemoryNotesRepository();
    notesService = new NotesService(repository, {
      findByNote: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    } as any);
    workspaceId = WorkspaceId(uuidv4());
  });

  describe('tasks.getMyTask', () => {
    it('should get task for agent with taskNoteId in metadata', async () => {
      // First create a task note
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Test Task',
        content: 'Task content',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const noteId = createResult.data.id;

      // Mark as task
      const markResult = await notesService.markAsTask(workspaceId, noteId, {
        status: 'not_started',
      });

      expect(markResult.ok).toBe(true);

      // Get task by noteId
      const getResult = await notesService.getNote(workspaceId, noteId);

      expect(getResult.ok).toBe(true);
      if (!getResult.ok) return;
      expect(getResult.data.id).toBe(noteId);
      expect(getResult.data.metadata?.task).toBeDefined();
    });

    it('should return error if task not found', async () => {
      const fakeNoteId = uuidv4() as NoteId;

      const result = await notesService.getNote(workspaceId, fakeNoteId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    });
  });

  describe('tasks.createPrerequisite', () => {
    it('should create prerequisite task and add dependency', async () => {
      // Create parent task
      const parentResult = await notesService.createNote({
        workspaceId,
        title: 'Parent Task',
        content: 'Parent content',
      });

      expect(parentResult.ok).toBe(true);
      if (!parentResult.ok) return;
      const parentId = parentResult.data.id;

      // Mark parent as task
      await notesService.markAsTask(workspaceId, parentId, {
        status: 'not_started',
      });

      // Create prerequisite - now returns { note, agent }
      const prereqResult = await notesService.createPrerequisiteNote(workspaceId, parentId, {
        title: 'Prerequisite Task',
        content: 'Prerequisite content',
      });

      expect(prereqResult.ok).toBe(true);
      if (!prereqResult.ok) return;
      const prerequisiteNote = prereqResult.data.note;
      expect(prerequisiteNote).toBeDefined();
      expect(prerequisiteNote.metadata?.task).toBeDefined();

      // Verify parentId was set (task orchestration now uses parentId as the dependency graph)
      expect(prerequisiteNote.parentId).toBe(parentId);
    });
  });

  describe('convertTaskBlocks', () => {
    it('should convert @@@task blocks to linked Task Notes', async () => {
      // Create a note with @@@task blocks
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `# My Spec

## Tasks

@@@task
# Task One
First task description
@@@

@@@task
# Task Two
Second task description
@@@

@@@task
# Task Three
Third task description
@@@
`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const noteId = createResult.data.id;

      // Convert task blocks
      const convertResult = await notesService.convertTaskBlocks(workspaceId, noteId);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      expect(convertResult.data.convertedCount).toBe(3);
      expect(convertResult.data.createdNoteIds).toHaveLength(3);
    });

    it('should set parentId on created tasks to link them to the parent note', async () => {
      // Create a note with @@@task blocks
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `# My Spec

@@@task
# First Task
First task description
@@@

@@@task
# Second Task
Second task description
@@@
`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const noteId = createResult.data.id;

      // Convert task blocks
      const convertResult = await notesService.convertTaskBlocks(workspaceId, noteId);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      const { createdNoteIds } = convertResult.data;
      expect(createdNoteIds).toHaveLength(2);

      // Verify parentId was set on each created task note
      // (task orchestration now uses parentId as the dependency graph)
      for (const taskNoteId of createdNoteIds) {
        const taskNote = await notesService.getNote(workspaceId, taskNoteId as NoteId);
        expect(taskNote.ok).toBe(true);
        if (!taskNote.ok) continue;
        expect(taskNote.data.parentId).toBe(noteId);
      }
    });

    it('should preserve document order via peerOrder on created tasks', async () => {
      // Create a note with @@@task blocks in specific order
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `# My Spec

@@@task
# Alpha Task
Alpha description
@@@

@@@task
# Beta Task
Beta description
@@@

@@@task
# Gamma Task
Gamma description
@@@
`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const noteId = createResult.data.id;

      // Convert task blocks
      const convertResult = await notesService.convertTaskBlocks(workspaceId, noteId);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      expect(convertResult.data.createdNoteIds).toHaveLength(3);

      // Get the task notes to verify order matches
      const taskNotes = await Promise.all(
        convertResult.data.createdNoteIds.map((id) =>
          notesService.getNote(workspaceId, id as NoteId),
        ),
      );

      // First created note should have title "Alpha Task"
      expect(taskNotes[0].ok && taskNotes[0].data.title).toBe('Alpha Task');
      expect(taskNotes[1].ok && taskNotes[1].data.title).toBe('Beta Task');
      expect(taskNotes[2].ok && taskNotes[2].data.title).toBe('Gamma Task');

      // Verify all tasks have parentId set and peerOrder preserves document order
      for (const taskNote of taskNotes) {
        expect(taskNote.ok).toBe(true);
        if (!taskNote.ok) continue;
        expect(taskNote.data.parentId).toBe(noteId);
        expect(taskNote.data.metadata?.task?.peerOrder).toBeDefined();
      }

      // peerOrder should increase for each task (preserving document order)
      if (taskNotes[0].ok && taskNotes[1].ok && taskNotes[2].ok) {
        const order0 = taskNotes[0].data.metadata?.task?.peerOrder ?? 0;
        const order1 = taskNotes[1].data.metadata?.task?.peerOrder ?? 0;
        const order2 = taskNotes[2].data.metadata?.task?.peerOrder ?? 0;
        expect(order0).toBeLessThan(order1);
        expect(order1).toBeLessThan(order2);
      }
    });

    it('should mark created notes as tasks with not_started status', async () => {
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `@@@task
# My Task
Task description
@@@`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, createResult.data.id);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      const taskNote = await notesService.getNote(
        workspaceId,
        convertResult.data.createdNoteIds[0] as NoteId,
      );

      expect(taskNote.ok).toBe(true);
      if (!taskNote.ok) return;

      expect(taskNote.data.metadata?.task).toBeDefined();
      expect(taskNote.data.metadata?.task?.status).toBe('not_started');
    });

    it('should set parentId on created task notes for hierarchy', async () => {
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Parent Spec',
        content: `@@@task
# Child Task
Child task description
@@@`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const parentId = createResult.data.id;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, parentId);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      const childNote = await notesService.getNote(
        workspaceId,
        convertResult.data.createdNoteIds[0] as NoteId,
      );

      expect(childNote.ok).toBe(true);
      if (!childNote.ok) return;

      expect(childNote.data.parentId).toBe(parentId);
    });

    it('should handle note with no task blocks', async () => {
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Regular Note',
        content: '# Just a regular note\n\n- [ ] Regular checklist item',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, createResult.data.id);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      expect(convertResult.data.convertedCount).toBe(0);
      expect(convertResult.data.createdNoteIds).toHaveLength(0);
    });

    it('should update note content with linked task syntax', async () => {
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `@@@task
# My Task
Task description
@@@`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, createResult.data.id);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      // Check the updated content
      const updatedNote = await notesService.getNote(workspaceId, createResult.data.id);
      expect(updatedNote.ok).toBe(true);
      if (!updatedNote.ok) return;

      // Content should have linked syntax, not task block
      expect(updatedNote.data.content).not.toContain('@@@task');
      expect(updatedNote.data.content).toContain('intent://local/task/');
      expect(updatedNote.data.content).toContain(convertResult.data.createdNoteIds[0]);
    });

    it('should auto-convert @@@task blocks saved through updateNote', async () => {
      const mockSendToWorkspaceWindows = vi.mocked(sendToWorkspaceWindows);
      mockSendToWorkspaceWindows.mockClear();

      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: '# My Spec\n\n## Tasks\n',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const updateResult = await notesService.updateNote({
        workspaceId,
        id: createResult.data.id,
        content: `# My Spec

## Tasks

@@@task
# Saved Task
Saved through the normal update path.
@@@`,
      });

      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      expect(updateResult.data.content).not.toContain('@@@task');
      expect(updateResult.data.content).toContain('- [ ] [Saved Task](intent://local/task/');

      const childTasks = (await repository.findByWorkspace(workspaceId)).filter(
        (note) => note.parentId === createResult.data.id,
      );
      expect(childTasks).toHaveLength(1);
      expect(childTasks[0].title).toBe('Saved Task');
      expect(childTasks[0].metadata?.task?.status).toBe('not_started');
      expect(updateResult.data.content).toContain(childTasks[0].id);

      expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
        workspaceId,
        `note:content-changed:${workspaceId}`,
        expect.objectContaining({
          noteId: createResult.data.id,
          content: updateResult.data.content,
          source: 'agent',
          workspaceId,
        }),
      );
    });

    it('should reuse an existing child task when updateNote saves the same task block again', async () => {
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: '# My Spec\n',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const rawTaskBlock = `# My Spec

@@@task
# Reused Task
Do the reusable work.
@@@`;

      const firstUpdate = await notesService.updateNote({
        workspaceId,
        id: createResult.data.id,
        content: rawTaskBlock,
      });
      expect(firstUpdate.ok).toBe(true);

      const firstChildTasks = (await repository.findByWorkspace(workspaceId)).filter(
        (note) => note.parentId === createResult.data.id,
      );
      expect(firstChildTasks).toHaveLength(1);

      const secondUpdate = await notesService.updateNote({
        workspaceId,
        id: createResult.data.id,
        content: rawTaskBlock,
      });

      expect(secondUpdate.ok).toBe(true);
      if (!secondUpdate.ok) return;

      const childTasks = (await repository.findByWorkspace(workspaceId)).filter(
        (note) => note.parentId === createResult.data.id,
      );
      expect(childTasks).toHaveLength(1);
      expect(childTasks[0].id).toBe(firstChildTasks[0].id);
      expect(secondUpdate.data.content).not.toContain('@@@task');
      expect(secondUpdate.data.content).toContain(firstChildTasks[0].id);
    });

    it('should clean up blank lines between consecutive linked task lines', async () => {
      // Create a note with task blocks that have blank lines between them
      // This is common when agents write task blocks with markdown formatting
      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `# My Spec

## Tasks

@@@task
# Task One
First task
@@@

@@@task
# Task Two
Second task
@@@

@@@task
# Task Three
Third task
@@@
`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, createResult.data.id);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;

      // Get the updated note
      const updatedNote = await notesService.getNote(workspaceId, createResult.data.id);
      expect(updatedNote.ok).toBe(true);
      if (!updatedNote.ok) return;

      // The linked task lines should be consecutive without blank lines between them
      // This creates a proper markdown list
      const content = updatedNote.data.content || '';

      // There should NOT be blank lines between consecutive task lines
      // Pattern that should NOT exist: task line, blank line, task line
      const blankLineBetweenTasks =
        /- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\)\n\n+- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\)/;
      expect(blankLineBetweenTasks.test(content)).toBe(false);

      // But there should still be the tasks on separate lines
      expect(content).toContain('- [ ] [Task One]');
      expect(content).toContain('- [ ] [Task Two]');
      expect(content).toContain('- [ ] [Task Three]');
    });

    it('should emit both note:updated and note:content-changed events after conversion', async () => {
      const mockSendToWorkspaceWindows = vi.mocked(sendToWorkspaceWindows);
      mockSendToWorkspaceWindows.mockClear();

      const createResult = await notesService.createNote({
        workspaceId,
        title: 'Spec Note',
        content: `@@@task
# Event Task
Task that should trigger events
@@@`,
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const noteId = createResult.data.id;

      const convertResult = await notesService.convertTaskBlocks(workspaceId, noteId);

      expect(convertResult.ok).toBe(true);
      if (!convertResult.ok) return;
      expect(convertResult.data.convertedCount).toBe(1);

      // Verify sendToWorkspaceWindows was called with note:updated
      expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
        workspaceId,
        'note:updated',
        expect.objectContaining({
          noteId,
          source: 'agent',
          workspaceId,
        }),
      );

      // Verify sendToWorkspaceWindows was called with note:content-changed:<workspaceId>
      expect(mockSendToWorkspaceWindows).toHaveBeenCalledWith(
        workspaceId,
        `note:content-changed:${workspaceId}`,
        expect.objectContaining({
          noteId,
          source: 'agent',
          workspaceId,
        }),
      );
    });
  });
});

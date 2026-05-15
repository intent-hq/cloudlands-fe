import {
  describe,
  it,
  expect,
} from 'vitest';
import { buildTaskAgentInitialMessage } from '../task-agent-message-builder';
import type { Note } from '$shared/types';
import {
  createNoteId,
  createWorkspaceId,
} from '$shared/types/branded-ids';

describe('buildTaskAgentInitialMessage', () => {
  const workspaceId = createWorkspaceId('test-workspace');
  const noteId = createNoteId('test-note');

  it('should build basic message for task note', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Implement feature X',
      content: 'Add new feature to the system',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        task: {
          status: 'not_started',
        },
      },
    };

    const message = buildTaskAgentInitialMessage(note);

    expect(message).toContain('You have been assigned to work on a task note');
    expect(message).toContain('Implement feature X');
    expect(message).toContain(noteId);
    expect(message).toContain('not_started');
    expect(message).toContain('Add new feature to the system');
  });

  it('should include dependencies when present', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Task with dependencies',
      content: 'Complete this task',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        task: {
          status: 'not_started',
        },
        dependencies: [
          { noteId: createNoteId('dep-1'), type: 'prerequisite' },
          { noteId: createNoteId('dep-2'), type: 'blocks' },
        ],
      },
    };

    const message = buildTaskAgentInitialMessage(note);

    expect(message).toContain('Dependencies (2)');
    expect(message).toContain('dep-1');
    expect(message).toContain('dep-2');
    expect(message).toContain('prerequisite');
    expect(message).toContain('blocks');
  });

  it('should include user instructions when provided', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Task',
      content: 'Do something',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        task: {
          status: 'not_started',
        },
      },
    };

    const userInstruction = 'Focus on performance optimization';
    const message = buildTaskAgentInitialMessage(note, userInstruction);

    expect(message).toContain('Additional instructions:');
    expect(message).toContain('Focus on performance optimization');
  });

  it('should handle note without task metadata', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Regular note',
      content: 'Some content',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const message = buildTaskAgentInitialMessage(note);

    expect(message).toContain('Regular note');
    expect(message).toContain('Some content');
    // Should still build a valid message even without task metadata
  });

  it('should handle empty content', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Empty task',
      content: '',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        task: {
          status: 'not_started',
        },
      },
    };

    const message = buildTaskAgentInitialMessage(note);

    expect(message).toContain('(no content)');
  });

  it('should include first steps guidance', () => {
    const note: Note = {
      id: noteId,
      workspaceId,
      title: 'Task',
      content: 'Content',
      contentType: 'markdown',
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        task: {
          status: 'not_started',
        },
      },
    };

    const message = buildTaskAgentInitialMessage(note);

    expect(message).toContain('First steps:');
    expect(message).toContain('Read your task note');
    expect(message).toContain('Review any dependencies');
    expect(message).toContain('Update status to "in_progress"');
    expect(message).toContain('Remember:');
    expect(message).toContain('Update the task note regularly');
  });
});

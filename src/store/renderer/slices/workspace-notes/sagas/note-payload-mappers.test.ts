import { describe, expect, it } from 'vitest';
import type { Note, TaskMetadata } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { toRuntimeNote } from './note-payload-mappers';

function makeNote(task: TaskMetadata): Note {
  return {
    id: NoteId('note-1'),
    workspaceId: WorkspaceId('ws-1'),
    title: 'Task note',
    content: 'body',
    contentType: 'markdown',
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: 'shared',
    metadata: { task },
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
  } as Note;
}

// Regression guard for the field-enumerating copy in copyTask: a newly added
// TaskMetadata field is silently stripped unless explicitly carried over
// (dependsOn/conflictsWith were dropped on the hydrate path this way after
// fe#1038; unmetDependsOn is the v6.8 projection from monorepo#1979).
describe('toRuntimeNote — metadata.task relation fields', () => {
  it('preserves dependsOn, conflictsWith, and unmetDependsOn', () => {
    const runtime = toRuntimeNote(
      makeNote({
        status: 'not_started',
        dependsOn: [NoteId('dep-a'), NoteId('dep-b')],
        conflictsWith: [NoteId('con-c')],
        unmetDependsOn: [NoteId('dep-a')],
      }),
    );

    expect(runtime.metadata?.task?.dependsOn).toEqual(['dep-a', 'dep-b']);
    expect(runtime.metadata?.task?.conflictsWith).toEqual(['con-c']);
    expect(runtime.metadata?.task?.unmetDependsOn).toEqual(['dep-a']);
  });

  it('copies relation arrays instead of aliasing the payload', () => {
    const task: TaskMetadata = {
      status: 'not_started',
      dependsOn: [NoteId('dep-a')],
      unmetDependsOn: [NoteId('dep-a')],
    };
    const runtime = toRuntimeNote(makeNote(task));

    expect(runtime.metadata?.task?.dependsOn).not.toBe(task.dependsOn);
    expect(runtime.metadata?.task?.unmetDependsOn).not.toBe(task.unmetDependsOn);
  });

  it('omits relation fields that are absent on the wire payload', () => {
    const runtime = toRuntimeNote(makeNote({ status: 'not_started' }));

    expect(runtime.metadata?.task).not.toHaveProperty('dependsOn');
    expect(runtime.metadata?.task).not.toHaveProperty('conflictsWith');
    expect(runtime.metadata?.task).not.toHaveProperty('unmetDependsOn');
  });
});

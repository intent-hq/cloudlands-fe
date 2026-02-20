import { describe, it, expect, beforeEach } from 'vitest';
import { NotesService } from '../notes.service';
import type { WorkspaceId } from '../../../shared/types';
import { randomUUID } from 'crypto';

describe('NotesService.addDependency - Cycle Detection', () => {
  let service: NotesService;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    service = new NotesService();
    workspaceId = randomUUID() as WorkspaceId;
  });

  it('should prevent direct cycle (A -> B -> A)', async () => {
    // Arrange
    const noteAResult = await service.createNote({
      workspaceId,
      title: 'Task A',
      content: 'Content A',
    });
    const noteBResult = await service.createNote({
      workspaceId,
      title: 'Task B',
      content: 'Content B',
    });

    expect(noteAResult.ok && noteBResult.ok).toBe(true);
    if (!noteAResult.ok || !noteBResult.ok) return;

    const noteA = noteAResult.data;
    const noteB = noteBResult.data;

    // Create A -> B
    await service.addDependency(workspaceId, noteA.id, {
      noteId: noteB.id,
      type: 'blocks',
    });

    // Act - try to create B -> A (would create cycle)
    const result = await service.addDependency(workspaceId, noteB.id, {
      noteId: noteA.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cycle');
    }
  });

  it('should prevent indirect cycle (A -> B -> C -> A)', async () => {
    // Arrange
    const noteAResult = await service.createNote({
      workspaceId,
      title: 'Task A',
      content: 'Content A',
    });
    const noteBResult = await service.createNote({
      workspaceId,
      title: 'Task B',
      content: 'Content B',
    });
    const noteCResult = await service.createNote({
      workspaceId,
      title: 'Task C',
      content: 'Content C',
    });

    expect(noteAResult.ok && noteBResult.ok && noteCResult.ok).toBe(true);
    if (!noteAResult.ok || !noteBResult.ok || !noteCResult.ok) return;

    const noteA = noteAResult.data;
    const noteB = noteBResult.data;
    const noteC = noteCResult.data;

    // Create A -> B -> C
    await service.addDependency(workspaceId, noteA.id, {
      noteId: noteB.id,
      type: 'blocks',
    });
    await service.addDependency(workspaceId, noteB.id, {
      noteId: noteC.id,
      type: 'blocks',
    });

    // Act - try to create C -> A (would create cycle)
    const result = await service.addDependency(workspaceId, noteC.id, {
      noteId: noteA.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cycle');
    }
  });

  it('should prevent longer cycle (A -> B -> C -> D -> A)', async () => {
    // Arrange
    const noteAResult = await service.createNote({
      workspaceId,
      title: 'Task A',
      content: 'Content A',
    });
    const noteBResult = await service.createNote({
      workspaceId,
      title: 'Task B',
      content: 'Content B',
    });
    const noteCResult = await service.createNote({
      workspaceId,
      title: 'Task C',
      content: 'Content C',
    });
    const noteDResult = await service.createNote({
      workspaceId,
      title: 'Task D',
      content: 'Content D',
    });

    expect(noteAResult.ok && noteBResult.ok && noteCResult.ok && noteDResult.ok).toBe(true);
    if (!noteAResult.ok || !noteBResult.ok || !noteCResult.ok || !noteDResult.ok) return;

    const noteA = noteAResult.data;
    const noteB = noteBResult.data;
    const noteC = noteCResult.data;
    const noteD = noteDResult.data;

    // Create A -> B -> C -> D
    await service.addDependency(workspaceId, noteA.id, {
      noteId: noteB.id,
      type: 'blocks',
    });
    await service.addDependency(workspaceId, noteB.id, {
      noteId: noteC.id,
      type: 'blocks',
    });
    await service.addDependency(workspaceId, noteC.id, {
      noteId: noteD.id,
      type: 'blocks',
    });

    // Act - try to create D -> A (would create cycle)
    const result = await service.addDependency(workspaceId, noteD.id, {
      noteId: noteA.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cycle');
    }
  });

  it('should allow diamond dependency (A -> B, A -> C, B -> D, C -> D)', async () => {
    // Arrange - diamond pattern is NOT a cycle
    const noteAResult = await service.createNote({
      workspaceId,
      title: 'Task A',
      content: 'Content A',
    });
    const noteBResult = await service.createNote({
      workspaceId,
      title: 'Task B',
      content: 'Content B',
    });
    const noteCResult = await service.createNote({
      workspaceId,
      title: 'Task C',
      content: 'Content C',
    });
    const noteDResult = await service.createNote({
      workspaceId,
      title: 'Task D',
      content: 'Content D',
    });

    expect(noteAResult.ok && noteBResult.ok && noteCResult.ok && noteDResult.ok).toBe(true);
    if (!noteAResult.ok || !noteBResult.ok || !noteCResult.ok || !noteDResult.ok) return;

    const noteA = noteAResult.data;
    const noteB = noteBResult.data;
    const noteC = noteCResult.data;
    const noteD = noteDResult.data;

    // Create A -> B, A -> C
    await service.addDependency(workspaceId, noteA.id, {
      noteId: noteB.id,
      type: 'blocks',
    });
    await service.addDependency(workspaceId, noteA.id, {
      noteId: noteC.id,
      type: 'blocks',
    });

    // Create B -> D
    await service.addDependency(workspaceId, noteB.id, {
      noteId: noteD.id,
      type: 'blocks',
    });

    // Act - create C -> D (diamond pattern, should be allowed)
    const result = await service.addDependency(workspaceId, noteC.id, {
      noteId: noteD.id,
      type: 'blocks',
    });

    // Assert
    expect(result.ok).toBe(true);
  });
});

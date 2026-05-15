/**
 * Tests for Notes Repository
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import { InMemoryNotesRepository } from '../notes.repository';
import type { Note } from '../../../shared/types';
import {
  ContentType,
  NoteVisibility,
} from '../../../shared/types';

import { randomUUID } from 'crypto';

describe('InMemoryNotesRepository', () => {
  let repository: InMemoryNotesRepository;
  let workspaceId: string;

  beforeEach(() => {
    repository = new InMemoryNotesRepository();
    workspaceId = randomUUID();
  });

  // Helper function to create test note
  const createTestNote = (overrides?: Partial<Note>): Note => ({
    id: randomUUID(),
    workspaceId,
    title: 'Test Note',
    content: 'Test content',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  describe('save and findById', () => {
    it('should save and retrieve a note', async () => {
      const note = createTestNote();

      await repository.save(note);
      const retrieved = await repository.findById(workspaceId, note.id);

      expect(retrieved).toEqual(note);
    });

    it('should return null for non-existent note', async () => {
      const result = await repository.findById(workspaceId, randomUUID());
      expect(result).toBeNull();
    });

    it('should update existing note', async () => {
      const note = createTestNote({ title: 'Original Title' });

      await repository.save(note);

      const updated = { ...note, title: 'Updated Title' };
      await repository.save(updated);

      const retrieved = await repository.findById(workspaceId, note.id);
      expect(retrieved?.title).toBe('Updated Title');
    });
  });

  describe('findByWorkspace', () => {
    it('should return empty array when no notes', async () => {
      const notes = await repository.findByWorkspace(workspaceId);
      expect(notes).toEqual([]);
    });

    it('should return all notes for workspace', async () => {
      const note1 = createTestNote({ title: 'Note 1' });
      const note2 = createTestNote({ title: 'Note 2' });

      await repository.save(note1);
      await repository.save(note2);

      const notes = await repository.findByWorkspace(workspaceId);
      expect(notes).toHaveLength(2);
      expect(notes.map((n) => n.id)).toContain(note1.id);
      expect(notes.map((n) => n.id)).toContain(note2.id);
    });

    it('should not return notes from other workspaces', async () => {
      const workspace1 = randomUUID();
      const workspace2 = randomUUID();

      const note1 = createTestNote({ workspaceId: workspace1, title: 'Note 1' });
      const note2 = createTestNote({ workspaceId: workspace2, title: 'Note 2' });

      await repository.save(note1);
      await repository.save(note2);

      const notes1 = await repository.findByWorkspace(workspace1);
      expect(notes1).toHaveLength(1);
      expect(notes1[0].id).toBe(note1.id);

      const notes2 = await repository.findByWorkspace(workspace2);
      expect(notes2).toHaveLength(1);
      expect(notes2[0].id).toBe(note2.id);
    });
  });

  describe('delete', () => {
    it('should delete a note', async () => {
      const note = createTestNote();

      await repository.save(note);
      await repository.delete(workspaceId, note.id);

      const retrieved = await repository.findById(workspaceId, note.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when deleting non-existent note', async () => {
      await expect(repository.delete(workspaceId, randomUUID())).rejects.toThrow('not found');
    });
  });

  describe('exists', () => {
    it('should return true for existing note', async () => {
      const note = createTestNote();

      await repository.save(note);
      const exists = await repository.exists(workspaceId, note.id);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent note', async () => {
      const exists = await repository.exists(workspaceId, randomUUID());
      expect(exists).toBe(false);
    });
  });

  describe('count', () => {
    it('should return 0 when no notes', () => {
      expect(repository.count()).toBe(0);
    });

    it('should return correct count', async () => {
      const note1 = createTestNote({ title: 'Note 1' });
      const note2 = createTestNote({ title: 'Note 2' });

      await repository.save(note1);
      expect(repository.count()).toBe(1);

      await repository.save(note2);
      expect(repository.count()).toBe(2);

      await repository.delete(workspaceId, note1.id);
      expect(repository.count()).toBe(1);
    });
  });
});

/**
 * Integration tests for NotesService anchor recovery
 *
 * These tests verify that anchor recovery is properly integrated into the
 * note save flow. They mock dependencies (repository, comments service, event bus)
 * but test the real recovery logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotesService } from '../main/notes.service';
import type { Note, NoteVersion, UpdateNoteRequest, NoteComment } from '../../../shared/types';
import { ContentType, NoteVisibility } from '../../../shared/types';
import type { NotesRepository } from '../main/notes.repository';
import type { CommentsRepository } from '../../comments/comments.repository';
import type { UnifiedEventBus } from '../../events/main/unified-event-bus';

describe('NotesService - Anchor Recovery Integration', () => {
  let notesService: NotesService;
  let mockNotesRepository: NotesRepository;
  let mockCommentsRepository: CommentsRepository;
  let mockEventBus: UnifiedEventBus;

  // Helper to create test note
  const createTestNote = (overrides?: Partial<Note>): Note => ({
    id: 'note-1',
    workspaceId: 'workspace-1',
    title: 'Test Note',
    content: 'Hello world',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    versions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create test version
  const createTestVersion = (content: string, versionNumber: number): NoteVersion => ({
    versionId: `v${versionNumber}`,
    versionNumber,
    content,
    title: 'Test Note',
    createdAt: new Date().toISOString(),
  });

  // Helper to create test comment
  const createTestComment = (id: string): NoteComment => ({
    id,
    noteId: 'note-1',
    author: 'user',
    authorType: 'user',
    type: 'comment',
    content: 'Test comment',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    // Create mocks
    mockNotesRepository = {
      findById: vi.fn(),
      save: vi.fn(),
      findAll: vi.fn(),
      delete: vi.fn(),
      findByWorkspace: vi.fn(),
    } as unknown as NotesRepository;

    mockCommentsRepository = {
      findByNote: vi.fn(),
      findById: vi.fn(),
      save: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as CommentsRepository;

    mockEventBus = {
      emit: vi.fn(),
      emitEvent: vi.fn(),
      emitDomainEvent: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      onDomainEvent: vi.fn(),
      offDomainEvent: vi.fn(),
    } as unknown as UnifiedEventBus;

    // Create service with mocks
    notesService = new NotesService(mockNotesRepository, mockCommentsRepository, mockEventBus);
  });

  describe('Recovery on save', () => {
    it('should recover partial anchors when saving note', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
        versions: [createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1)],
      });

      // Mock repository to return existing note
      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);

      // Mock comments service to return comment
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      // User edits and accidentally removes end anchor
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->world', // End anchor missing
      };

      await notesService.updateNote(request);

      // Verify: Saved with recovered anchor
      expect(mockNotesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<!--anchor:c1:end-->'),
        }),
      );
    });

    it('should emit event when recovery happens', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
        versions: [createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1)],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      // User edits and removes end anchor
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->world', // End anchor missing
      };

      await notesService.updateNote(request);

      // Verify: Event emitted with recovered comment IDs
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'notes:anchors-recovered',
        expect.objectContaining({
          noteId: 'note-1',
          commentIds: expect.arrayContaining(['c1']),
        }),
      );
    });

    it('should not emit event if no recovery needed', async () => {
      // Setup: Note with healthy anchors
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
        versions: [],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
      };

      await notesService.updateNote(request);

      // Verify: No recovery event emitted
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        'notes:anchors-recovered',
        expect.anything(),
      );
    });

    it('should handle multiple partial anchors', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content:
          'Hello <!--anchor:c1:start-->world<!--anchor:c1:end--> and <!--anchor:c2:start-->goodbye<!--anchor:c2:end-->',
        versions: [
          createTestVersion(
            'Hello <!--anchor:c1:start-->world<!--anchor:c1:end--> and <!--anchor:c2:start-->goodbye<!--anchor:c2:end-->',
            1,
          ),
        ],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([
        createTestComment('c1'),
        createTestComment('c2'),
      ]);

      // User edits and removes c1's end anchor
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content:
          'Hello <!--anchor:c1:start-->world and <!--anchor:c2:start-->goodbye<!--anchor:c2:end-->', // c1 end missing
      };

      await notesService.updateNote(request);

      // Verify: c1 anchor recovered
      expect(mockNotesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<!--anchor:c1:end-->'),
        }),
      );

      // Verify: Event includes recovered comment ID
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'notes:anchors-recovered',
        expect.objectContaining({
          commentIds: expect.arrayContaining(['c1']),
        }),
      );
    });

    it('should use recovered content in version history', async () => {
      // Setup: Note with partial anchor
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world',
        versions: [createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1)],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->world',
      };

      await notesService.updateNote(request);

      // Verify: Version created with recovered content
      expect(mockNotesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          versions: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('<!--anchor:c1:end-->'),
            }),
          ]),
        }),
      );
    });

    it('should handle recovery failure gracefully', async () => {
      // Setup: Note with partial anchor but no healthy version
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->completely different text',
        versions: [
          createTestVersion('Hello world', 1), // No anchors
        ],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->completely different text',
      };

      // Should not throw
      await expect(notesService.updateNote(request)).resolves.toBeDefined();

      // Verify: Saved with original content (recovery failed)
      expect(mockNotesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello <!--anchor:c1:start-->completely different text',
        }),
      );

      // Verify: No recovery event emitted
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        'notes:anchors-recovered',
        expect.anything(),
      );
    });

    it('should mark comments as orphaned when recovery fails', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
        versions: [createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1)],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      // User edits and creates partial anchor with completely different text (cannot be recovered)
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Goodbye <!--anchor:c1:start-->completely different text',
      };

      await notesService.updateNote(request);

      // Verify: Comment was marked as orphaned in the database
      expect(mockCommentsRepository.update).toHaveBeenCalledWith(
        'workspace-1',
        'note-1',
        'c1',
        expect.objectContaining({
          isOrphaned: true,
        }),
      );
    });

    it('should not mark comments as orphaned when recovery succeeds', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->',
        versions: [createTestVersion('Hello <!--anchor:c1:start-->world<!--anchor:c1:end-->', 1)],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      // User edits and removes end anchor, but recovery can succeed
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start-->world',
      };

      await notesService.updateNote(request);

      // Verify: Comment was NOT marked as orphaned (recovery succeeded)
      expect(mockCommentsRepository.update).not.toHaveBeenCalledWith(
        'workspace-1',
        'note-1',
        'c1',
        expect.objectContaining({
          isOrphaned: true,
        }),
      );
    });

    it('should mark degenerate anchors as orphaned', async () => {
      // Setup: Note with healthy anchors initially
      const existingNote = createTestNote({
        content: 'Hello <!--anchor:c1:start-->text<!--anchor:c1:end--> world',
        versions: [
          createTestVersion('Hello <!--anchor:c1:start-->text<!--anchor:c1:end--> world', 1),
        ],
      });

      vi.mocked(mockNotesRepository.findById).mockResolvedValue(existingNote);
      vi.mocked(mockCommentsRepository.findByNote).mockResolvedValue([createTestComment('c1')]);

      // User edits and accidentally deletes the text between anchors, creating degenerate anchor
      const request: UpdateNoteRequest = {
        id: 'note-1',
        workspaceId: 'workspace-1',
        content: 'Hello <!--anchor:c1:start--><!--anchor:c1:end--> world',
      };

      await notesService.updateNote(request);

      // Verify: Degenerate anchors removed from saved content
      expect(mockNotesRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello  world', // Anchors removed
        }),
      );

      // Verify: Comment was marked as orphaned
      expect(mockCommentsRepository.update).toHaveBeenCalledWith(
        'workspace-1',
        'note-1',
        'c1',
        expect.objectContaining({
          isOrphaned: true,
        }),
      );
    });
  });
});

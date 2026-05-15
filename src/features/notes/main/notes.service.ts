/**
 * Notes Service
 *
 * Pure business logic for note operations.
 * Uses repository pattern for data access and event bus for notifications.
 */

import {
  ContentType,
  NoteVisibility,
  AuthorType,
} from '../../../shared/types';
import type {
  Note,
  NoteId,
  WorkspaceId,
  CreateNoteRequest,
  UpdateNoteRequest,
  Result,
  TaskMetadata,
  TaskStatus,
  AgentId,
  NoteComment,
} from '../../../shared/types';
import { stripMarkdownFormatting } from '../../../shared/utils-client';
// Re-export NoteComment for backwards compatibility
export type { NoteComment, NoteCommentsData } from '../../../shared/types';
import type { CommentsRepository } from '../../comments/main/comments.repository';
import type { NotesRepository } from './notes.repository';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  noteCreated,
  noteUpdated,
  noteDeleted,
} from '../../../store/main/slices/note-events/note-events-slice';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { FileSystemCommentsRepository } from '../../comments/main/comments.repository';
import { FileSystemNotesRepository } from './notes.repository';
import { Logger } from '../../../shared/logger';
import {
  createNoteId,
  NoteId as NoteIdBrand,
} from '../../../shared/types/branded-ids';
import { trackMain } from '$lib/services/analytics/main';
import { taskNoteLink } from '../../../shared/constants/intent-links';
import { editEventsCapturer } from './edit-events.capturer';
import { editEventsStore } from './edit-events.store';
import {
  generateCommentId,
  isValidCommentId,
} from '$shared/utils/comment-id-generator';
import { getProvenanceContextManager } from '../../workspace/main/provenance/provenance-context-manager';
import {
  createWorkspaceEvent,
  type EventActor,
} from '../../events/types';
import { randomUUID } from 'crypto';
import { recoverAllPartialAnchors } from '../../comments/markdown-anchor-recovery';
import { preserveAgentAnchors } from '../agent-anchor-preservation';
import { agentBackendHandler } from '../../agent/main/agent-backend-handler.service';
import { buildTaskAgentInitialMessage } from '../utils/task-agent-message-builder';
import { generateAgentNameFromTask } from '../utils/agent-name-utils';
import { findInvalidTaskLinks } from '../utils/task-link-validator';
import { hasTaskBlocks as containsTaskBlocks } from '../utils/task-block-parser';
import {
  FolderBasedNotesRepository,
  crdtDocumentManager,
  migrateWorkspaceNotes,
  workspaceNeedsMigration,
} from './storage';
import { getMetadataFS } from '../../metadata-fs/main/metadata-fs-factory';

import type { AgentSession } from '../../../shared/types';
import { workspaceService } from '../../workspace/main/workspace.service';

const logger = new Logger('NotesService');

/**
 * Maximum number of versions to keep per note
 * Older versions are pruned when this limit is exceeded
 */
const MAX_VERSIONS_PER_NOTE = 50;

/**
 * Feature flag for new storage format
 * Set to true to use folder-based storage with CRDT support
 */
const USE_NEW_STORAGE = true;

export class NotesService {
  private crdtEnabled = USE_NEW_STORAGE;

  constructor(
    private readonly notesRepository: NotesRepository = USE_NEW_STORAGE
      ? new FolderBasedNotesRepository(getMetadataFS)
      : new FileSystemNotesRepository(),
    private readonly commentsRepository: CommentsRepository = new FileSystemCommentsRepository(),
  ) {}

  /**
   * Migrate workspace notes to new format if needed
   */
  async ensureWorkspaceMigrated(workspaceId: WorkspaceId): Promise<void> {
    if (!this.crdtEnabled) return;

    try {
      if (await workspaceNeedsMigration(workspaceId)) {
        logger.info('Migrating workspace notes to new format', { workspaceId });
        const result = await migrateWorkspaceNotes(workspaceId);
        logger.info('Workspace migration complete', {
          workspaceId,
          migratedNotes: result.migratedNotes,
          failedNotes: result.failedNotes,
        });
      }
    } catch (error) {
      logger.error('Failed to migrate workspace notes', error as Error, { workspaceId });
    }
  }

  /**
   * Initialize CRDT document for a note
   */
  async initializeCRDT(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    if (!this.crdtEnabled) return;

    const note = await this.notesRepository.findById(workspaceId, noteId);
    if (note) {
      await crdtDocumentManager.initializeWithContent(workspaceId, noteId, note.content);
    }
  }

  /**
   * Create a new note
   */
  async createNote(
    request: CreateNoteRequest & { id?: string; isDefault?: boolean; isPinned?: boolean },
  ): Promise<Result<Note, string>> {
    try {
      logger.info('Creating note', {
        workspaceId: request.workspaceId,
        title: request.title,
        id: request.id,
      });

      // Use provided ID or generate a new one
      const id = request.id ? createNoteId(request.id) : createNoteId(randomUUID());
      const now = new Date().toISOString();

      const note: Note = {
        id,
        workspaceId: request.workspaceId,
        title: request.title,
        content: request.content,
        contentType: request.contentType || ContentType.Markdown,
        tags: request.tags || [],
        isPinned: request.isPinned || false,
        isArchived: false,
        isDefault: request.isDefault || false,
        parentId: request.parentId,
        visibility: request.visibility || NoteVisibility.Workspace,
        metadata: {
          author: {
            id: 'user',
            name: 'User',
            type: AuthorType.User,
          },
          wordCount: this.countWords(request.content),
          characterCount: request.content.length,
        },
        references: [],
        versions: [],
        createdAt: now,
        updatedAt: now,
        // Also include snake_case for backward compatibility
        created_at: now,
        updated_at: now,
        is_pinned: false,
        is_archived: false,
      };

      // Save note via repository
      await this.notesRepository.save(note);

      // Initialize CRDT document for concurrent editing support
      if (this.crdtEnabled) {
        await crdtDocumentManager.initializeWithContent(request.workspaceId, id, note.content);
      }

      // Get current actor for provenance
      const provenanceManager = getProvenanceContextManager();
      const currentActor = provenanceManager.getCurrentActor();
      const sessionId = provenanceManager.getCurrentSessionId();

      logger.info('Note created - actor info', {
        actor: currentActor,
        sessionId,
        actorType: currentActor?.type,
        actorName: currentActor?.name,
        actorId: currentActor?.id,
      });

      // Emit event with actor information
      mainDispatch(noteCreated({
        workspaceId: request.workspaceId,
        noteId: id,
        note,
        actor: currentActor,
      }));

      logger.info('Note created successfully', {
        workspaceId: request.workspaceId,
        noteId: id,
      });

      return { ok: true, data: note };
    } catch (error) {
      logger.error('Failed to create note', error as Error, {
        workspaceId: request.workspaceId,
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to create note',
      };
    }
  }

  /**
   * List notes for a workspace with optional pagination
   */
  async listNotes(
    workspaceId: WorkspaceId,
    options?: { offset?: number; limit?: number; skipSort?: boolean },
  ): Promise<Result<{ notes: Note[]; total: number; hasMore: boolean }, string>> {
    try {
      // Validate workspaceId
      if (!workspaceId) {
        logger.error('[NotesService] Cannot list notes without workspaceId');
        return {
          ok: false,
          error: 'Workspace ID is required to list notes',
        };
      }

      // Ensure workspace notes are migrated to new format
      await this.ensureWorkspaceMigrated(workspaceId);

      // Ensure spec exists before listing
      await this.ensureSpecExists(workspaceId);

      // Get all notes via repository
      const allNotes = await this.notesRepository.findByWorkspace(workspaceId);

      // PERF: Defer version pruning entirely off the critical path.
      // setTimeout ensures the synchronous prune loop doesn't run until after
      // the current microtask queue drains and the response is sent.
      setTimeout(() => {
        void (async () => {
          try {
            const notesToSave: Note[] = [];
            for (const note of allNotes) {
              if (this.pruneVersionsIfNeeded(note) > 0) {
                notesToSave.push(note);
              }
            }
            for (const note of notesToSave) {
              await this.notesRepository.save(note);
            }
          } catch (err) {
            logger.warn('Background version pruning failed', { error: err });
          }
        })();
      }, 0);

      // Sort by updated date, newest first (unless skipped for performance)
      if (!options?.skipSort) {
        allNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }

      // Apply pagination if requested
      const offset = options?.offset || 0;
      const limit = options?.limit || allNotes.length; // Default to all if no limit

      const paginatedNotes = allNotes.slice(offset, offset + limit);
      const hasMore = offset + limit < allNotes.length;

      return {
        ok: true,
        data: {
          notes: paginatedNotes,
          total: allNotes.length,
          hasMore,
        },
      };
    } catch (error) {
      logger.error('Failed to list notes', error as Error, { workspaceId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list notes',
      };
    }
  }

  /**
   * List all notes for a workspace (backward compatibility)
   */
  async listAllNotes(workspaceId: WorkspaceId): Promise<Result<Note[], string>> {
    const result = await this.listNotes(workspaceId);
    if (result.ok) {
      return { ok: true, data: result.data.notes };
    }
    return { ok: false, error: result.error };
  }

  /**
   * Prune old versions from a note if it exceeds the limit
   * This ensures versions don't grow unbounded even if pruning on update is missed
   * Returns the number of versions removed (0 if none removed)
   */
  private pruneVersionsIfNeeded(note: Note): number {
    if (!note.versions || note.versions.length <= MAX_VERSIONS_PER_NOTE) {
      return 0;
    }

    const versionsToRemove = note.versions.length - MAX_VERSIONS_PER_NOTE;
    note.versions = note.versions.slice(versionsToRemove);
    logger.debug('Pruned old versions on load', {
      noteId: note.id,
      versionsRemoved: versionsToRemove,
      remainingVersions: note.versions.length,
    });
    return versionsToRemove;
  }

  /**
   * Get a single note
   */
  async getNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<Result<Note, string>> {
    try {
      const note = await this.notesRepository.findById(workspaceId, noteId as NoteId);

      if (!note) {
        return {
          ok: false,
          error: 'Note not found',
        };
      }

      // Initialize CRDT document for concurrent editing support
      if (this.crdtEnabled) {
        await crdtDocumentManager.initializeWithContent(workspaceId, noteId, note.content);
      }

      // Prune versions if needed and save if pruning occurred
      if (this.pruneVersionsIfNeeded(note) > 0) {
        await this.notesRepository.save(note);
      }

      return { ok: true, data: note };
    } catch (error) {
      logger.error('Failed to get note', error as Error, { workspaceId, noteId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Note not found',
      };
    }
  }

  /**
   * Update a note
   */
  async updateNote(
    request: UpdateNoteRequest & { workspaceId?: WorkspaceId },
  ): Promise<Result<Note, string>> {
    // Require workspaceId for updates to prevent cross-workspace contamination
    if (!request.workspaceId) {
      logger.error('updateNote called without workspaceId', undefined, {
        noteId: request.id,
      });
      return {
        ok: false,
        error: 'workspaceId is required for note updates',
      };
    }

    try {
      // Get the note from the specific workspace
      const noteResult = await this.getNote(request.workspaceId, request.id);

      if (!noteResult.ok) {
        return noteResult;
      }

      const existingNote = noteResult.data;

      // Validate note belongs to requested workspace
      if (existingNote.workspaceId !== request.workspaceId) {
        logger.error('Attempted to update note from different workspace', undefined, {
          noteWorkspaceId: existingNote.workspaceId,
          requestedWorkspaceId: request.workspaceId,
          noteId: request.id,
        });
        return {
          ok: false,
          error: 'Note does not belong to this workspace',
        };
      }

      // Validate spec updates
      const validation = this.validateSpecUpdate(existingNote, request);
      if (!validation.valid) {
        return {
          ok: false,
          error: validation.error || 'Invalid update',
        };
      }

      // Create version before updating
      // IMPORTANT: The version should contain the NEW content being saved,
      // not the old content. This way versions represent the history of changes.
      let recoveredCommentIds: string[] = [];
      if (request.content !== undefined && request.content !== existingNote.content) {
        // Get all comment IDs for this note to check for partial anchors
        const comments = await this.commentsRepository.findByNote(request.workspaceId, request.id);
        const commentIds = comments.map((c) => c.id);

        // Attempt to recover any partial anchors
        const recoveryResult = recoverAllPartialAnchors(
          request.content,
          commentIds,
          existingNote.versions || [],
          request.id,
        );

        const finalContent = recoveryResult.markdown;
        recoveredCommentIds = recoveryResult.recovered;

        // Emit event if any anchors were recovered
        if (recoveredCommentIds.length > 0) {
          // notes:anchors-recovered event removed during Redux migration
          // Recovery info is logged and could be re-added as a Redux action if needed
          logger.info('Comment anchors recovered', {
            noteId: request.id,
            workspaceId: request.workspaceId,
            count: recoveredCommentIds.length,
          });
        }

        // Mark failed recoveries as orphaned
        if (recoveryResult.failed.length > 0) {
          for (const failedCommentId of recoveryResult.failed) {
            await this.commentsRepository.update(request.workspaceId, request.id, failedCommentId, {
              isOrphaned: true,
            });
          }
        }

        // Update request with recovered content
        request.content = finalContent;

        // Preserve agent anchors from existing content
        // When an agent updates a note, it may not include anchors for other agents
        if (existingNote.content) {
          const agentAnchorResult = preserveAgentAnchors(existingNote.content, request.content);
          request.content = agentAnchorResult.content;
          if (agentAnchorResult.preserved.length > 0) {
            logger.info('Preserved agent anchors during note update', {
              noteId: request.id,
              preserved: agentAnchorResult.preserved,
              lost: agentAnchorResult.lost,
            });
          }
        }

        // Check for invalid task links (agents sometimes write fake IDs)
        // Just log a warning - agents should use ```task blocks instead
        const taskLinkValidation = findInvalidTaskLinks(request.content);
        if (!taskLinkValidation.valid) {
          logger.warn('Found invalid task links in note content', {
            noteId: request.id,
            invalidLinks: taskLinkValidation.invalidLinks.map((l) => ({
              linkText: l.linkText,
              noteId: l.noteId,
              reason: l.reason,
            })),
          });
        }

        // Get current actor for provenance (used for both version and edit event)
        const provenanceManager = getProvenanceContextManager();
        const currentActor = provenanceManager.getCurrentActor();

        // Determine author info for version (using AuthorType enum)
        const versionAuthor = {
          id: currentActor?.id || 'user',
          name: currentActor?.name || 'User',
          type:
            currentActor?.type === 'agent'
              ? AuthorType.Agent
              : currentActor?.type === 'system'
                ? AuthorType.System
                : AuthorType.User,
          turnNumber: currentActor?.turnNumber,
        };

        // Determine author info for edit event (using string literals)
        const editAuthor = {
          id: currentActor?.id || 'user',
          name: currentActor?.name || 'User',
          type: (currentActor?.type === 'agent'
            ? 'agent'
            : currentActor?.type === 'system'
              ? 'system'
              : 'user') as 'user' | 'agent' | 'system',
        };

        const version = {
          versionId: randomUUID(),
          versionNumber: (existingNote.versions?.length || 0) + 1,
          content: request.content || '', // Ensure content is always a string
          title: request.title || existingNote.title,
          author: versionAuthor, // Use the current actor's author info with AuthorType enum
          createdAt: new Date().toISOString(),
          changeSummary: 'Content updated',
        };

        if (!existingNote.versions) {
          existingNote.versions = [];
        }
        existingNote.versions.push(version);

        // Prune old versions if we exceed the limit
        if (existingNote.versions.length > MAX_VERSIONS_PER_NOTE) {
          const versionsToRemove = existingNote.versions.length - MAX_VERSIONS_PER_NOTE;
          existingNote.versions = existingNote.versions.slice(versionsToRemove);
          logger.debug('Pruned old versions', {
            noteId: existingNote.id,
            versionsRemoved: versionsToRemove,
            remainingVersions: existingNote.versions.length,
          });
        }

        // Capture the edit event
        const editEvent = editEventsCapturer.captureEdit(
          existingNote.workspaceId,
          existingNote.id,
          existingNote.content || '',
          request.content || '',
          editAuthor,
          version.versionNumber,
        );

        // Append to edit events log (async, don't block on this)
        editEventsStore.append(editEvent).catch((error: Error) => {
          logger.error('Failed to append edit event', error, {
            noteId: existingNote.id,
            eventId: editEvent.id,
          });
        });
      }

      // Merge updates - carefully preserve metadata to avoid losing task info
      const now = new Date().toISOString();

      // IMPORTANT: Don't let undefined metadata from request overwrite existing metadata
      // Only merge metadata if request.metadata is explicitly provided
      const mergedMetadata = {
        ...existingNote.metadata, // Preserve existing metadata (including task)
        ...(request.metadata || {}), // Only merge if request.metadata is provided
      };

      const note: Note = {
        ...existingNote,
        ...request,
        id: existingNote.id, // Ensure ID doesn't change
        workspaceId: existingNote.workspaceId, // Ensure workspace doesn't change
        metadata: mergedMetadata, // Use carefully merged metadata
        updatedAt: now,
      };

      // Update metadata if content changed (preserve existing fields like task)
      if (request.content) {
        note.metadata = {
          ...note.metadata, // Preserve existing metadata including task
          wordCount: this.countWords(request.content),
          characterCount: request.content.length,
        };
      }

      // Save updated note via repository
      await this.notesRepository.save(note);

      // Update CRDT document to keep it in sync with file storage
      if (this.crdtEnabled && request.content !== undefined) {
        await crdtDocumentManager.updateContent(note.workspaceId, note.id, note.content);
      }

      let responseNote = note;

      if (request.content !== undefined && containsTaskBlocks(note.content || '')) {
        const conversionResult = await this.convertTaskBlocks(note.workspaceId, note.id);
        if (conversionResult.ok) {
          const convertedNote = await this.notesRepository.findById(note.workspaceId, note.id);
          if (convertedNote) {
            responseNote = convertedNote;
          }
        } else {
          logger.warn('Failed to auto-convert task blocks after note update', {
            workspaceId: note.workspaceId,
            noteId: note.id,
            error: conversionResult.error,
          });
        }
      }

      // Get current actor for proper attribution
      const provenanceManager = getProvenanceContextManager();
      const currentActor = provenanceManager.getCurrentActor();
      const emittedChanges = responseNote === note ? request : { ...request, content: responseNote.content };

      // Emit event with actor information (include title for Activity Log)
      mainDispatch(noteUpdated({
        workspaceId: responseNote.workspaceId,
        noteId: responseNote.id,
        title: responseNote.title,
        changes: emittedChanges,
        actor: currentActor,
        sessionId: provenanceManager.getCurrentSessionId(),
      }));

      // Track note edit
      trackMain('Edited Note', {
        note_type: responseNote.metadata?.task ? 'task' : 'regular',
        note_id: responseNote.id,
      });

      logger.info('Note updated', {
        workspaceId: responseNote.workspaceId,
        noteId: responseNote.id,
      });

      return { ok: true, data: responseNote };
    } catch (error) {
      logger.error('Failed to update note', error as Error, {
        workspaceId: request.workspaceId,
        noteId: request.id,
      });

      // Format ZodError nicely for agents
      let errorMessage = 'Failed to update note';
      if (error instanceof Error) {
        if ((error as any).name === 'ZodError' && (error as any).errors) {
          // Extract readable validation errors from Zod
          const zodErrors = (error as any).errors as Array<{ path: string[]; message: string }>;
          errorMessage = `Validation error: ${zodErrors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ')}`;
        } else {
          errorMessage = error.message;
        }
      }

      return {
        ok: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: NoteId, workspaceId: WorkspaceId): Promise<Result<void, string>> {
    try {
      // Get the note from the specific workspace
      const noteResult = await this.getNote(workspaceId, noteId);

      if (!noteResult.ok) {
        return { ok: false, error: 'Note not found' };
      }

      const note = noteResult.data;

      // Don't allow deleting the default spec
      if (note.isDefault) {
        return { ok: false, error: 'Cannot delete the workspace spec' };
      }

      // Delete via repository
      await this.notesRepository.delete(workspaceId, noteId);

      // Clean up CRDT session (no persistence needed since CRDT is session-only)
      if (this.crdtEnabled) {
        await crdtDocumentManager.removeDocument(workspaceId, noteId);
      }

      // Get current actor for proper attribution
      const provenanceManager = getProvenanceContextManager();
      const currentActor = provenanceManager.getCurrentActor();

      // Emit event with actor information
      mainDispatch(noteDeleted({
        workspaceId,
        noteId,
        actor: currentActor,
      }));

      // Track note deletion
      const ageInDays = Math.floor(
        (Date.now() - new Date(note.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      trackMain('Deleted Note', {
        note_type: note.metadata?.task ? 'task' : 'regular',
        note_age_days: ageInDays,
      });

      logger.info('Note deleted', { workspaceId, noteId });

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to delete note', error as Error, { workspaceId, noteId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to delete note',
      };
    }
  }

  // Private helper methods

  private async saveNote(note: Note): Promise<void> {
    // Validate required fields
    if (!note.workspaceId) {
      throw new Error('[NotesService] Cannot save note without workspaceId');
    }
    if (!note.id) {
      throw new Error('[NotesService] Cannot save note without id');
    }

    // Save via repository
    await this.notesRepository.save(note);
  }

  /**
   * Ensure a default spec note exists for the workspace.
   * This is idempotent - safe to call multiple times.
   * Returns the spec note (existing or newly created).
   */
  async ensureSpecExists(workspaceId: WorkspaceId): Promise<Result<Note, string>> {
    const specId = 'spec' as NoteId;
    const existingSpec = await this.notesRepository.findById(workspaceId, specId);

    if (!existingSpec) {
      // On remote workspaces, the spec may exist remotely but not be cached locally yet.
      // Only delete if the file physically exists but couldn't be parsed (corrupt).
      const fileExists = await this.notesRepository.exists(workspaceId, specId);
      if (fileExists) {
        try {
          await this.notesRepository.delete(workspaceId, specId);
        } catch { /* File might already be gone */ }
      }
      await this.createDefaultSpec(workspaceId);
    }

    return this.getNote(workspaceId, specId);
  }

  private async createDefaultSpec(workspaceId: WorkspaceId): Promise<void> {
    const now = new Date().toISOString();

    const spec: Note = {
      id: NoteIdBrand('spec'),
      workspaceId,
      title: 'Spec',
      content: '',
      contentType: ContentType.Markdown,
      tags: ['spec'],
      isPinned: true,
      isArchived: false,
      isDefault: true,
      visibility: NoteVisibility.Workspace,
      metadata: {
        author: {
          id: 'system',
          name: 'System',
          type: AuthorType.System,
        },
        wordCount: 0,
        characterCount: 0,
        task: {
          status: 'not_started' as TaskStatus,
        },
      },
      references: [],
      versions: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.saveNote(spec);
    logger.debug('Created default spec note', {
      workspaceId,
      noteId: spec.id,
    });
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  /**
   * Validate spec note updates to prevent data corruption
   * Returns true if the update should proceed, false otherwise
   */
  private validateSpecUpdate(
    existingNote: Note,
    updates: UpdateNoteRequest & { isUserAction?: boolean },
  ): { valid: boolean; error?: string } {
    // Only validate spec notes
    if (existingNote.id !== 'spec') {
      return { valid: true };
    }

    // Spec notes are critical - only allow content updates, not structural changes
    // Prevent modifications to title, tags, visibility, etc. unless explicitly allowed

    // Check if trying to modify title
    if (updates.title !== undefined && updates.title !== existingNote.title) {
      logger.warn('Blocked attempt to modify spec title', {
        noteId: existingNote.id,
        workspaceId: existingNote.workspaceId,
        oldTitle: existingNote.title,
        newTitle: updates.title,
      });
      return {
        valid: false,
        error: 'Spec title cannot be modified',
      };
    }

    // Check if trying to modify tags
    if (updates.tags !== undefined) {
      const newTags = updates.tags || [];
      const existingTags = existingNote.tags || [];
      if (JSON.stringify(newTags.sort()) !== JSON.stringify(existingTags.sort())) {
        logger.warn('Blocked attempt to modify spec tags', {
          noteId: existingNote.id,
          workspaceId: existingNote.workspaceId,
          oldTags: existingTags,
          newTags,
        });
        return {
          valid: false,
          error: 'Spec tags cannot be modified',
        };
      }
    }

    // Check if trying to modify visibility
    if (updates.visibility !== undefined && updates.visibility !== existingNote.visibility) {
      logger.warn('Blocked attempt to modify spec visibility', {
        noteId: existingNote.id,
        workspaceId: existingNote.workspaceId,
        oldVisibility: existingNote.visibility,
        newVisibility: updates.visibility,
      });
      return {
        valid: false,
        error: 'Spec visibility cannot be modified',
      };
    }

    // Check if trying to clear content
    if (updates.content !== undefined) {
      const newContent = updates.content.trim();
      const existingContent = existingNote.content?.trim() || '';

      // Allow clearing spec content if it's an explicit user action
      // This is indicated by the isUserAction flag or if the content is being replaced with a placeholder
      if (newContent.length === 0 && existingContent.length > 0) {
        // Allow if it's a user action or if replacing with minimal placeholder
        if (updates.isUserAction) {
          logger.info('Allowing user to clear spec content', {
            noteId: existingNote.id,
            workspaceId: existingNote.workspaceId,
          });
          return { valid: true };
        }

        logger.warn('Blocked attempt to clear spec content (not a user action)', {
          noteId: existingNote.id,
          workspaceId: existingNote.workspaceId,
          existingContentLength: existingContent.length,
        });
        return {
          valid: false,
          error:
            'Spec content cannot be cleared automatically. To reset the spec, use the clear action in the UI.',
        };
      }
    }

    return { valid: true };
  }

  /**
   * Restore spec content from the last non-empty version
   * This is an explicit recovery operation, not automatic
   */
  async restoreSpecFromVersion(
    workspaceId: WorkspaceId,
    versionId?: string,
  ): Promise<Result<Note, string>> {
    try {
      const noteResult = await this.getNote(workspaceId, 'spec' as NoteId);
      if (!noteResult.ok) {
        return noteResult;
      }

      const spec = noteResult.data;
      if (!spec.versions || spec.versions.length === 0) {
        return {
          ok: false,
          error: 'No versions available to restore from',
        };
      }

      let versionToRestore;
      if (versionId) {
        // Restore specific version
        versionToRestore = spec.versions.find((v) => v.versionId === versionId);
        if (!versionToRestore) {
          return {
            ok: false,
            error: `Version ${versionId} not found`,
          };
        }
      } else {
        // Find last non-empty version
        versionToRestore = [...spec.versions]
          .reverse()
          .find((v) => v.content && v.content.trim().length > 0);

        if (!versionToRestore) {
          return {
            ok: false,
            error: 'No non-empty versions found to restore',
          };
        }
      }

      // Update the spec with the restored content
      const updateResult = await this.updateNote({
        id: 'spec' as NoteId,
        workspaceId,
        content: versionToRestore.content,
      });

      if (updateResult.ok) {
        logger.info('Spec restored from version', {
          workspaceId,
          versionId: versionToRestore.versionId,
          versionNumber: versionToRestore.versionNumber,
        });
      }

      return updateResult;
    } catch (error) {
      logger.error('Failed to restore spec', error as Error, { workspaceId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to restore spec',
      };
    }
  }

  /**
   * Restore any note to a specific version
   * Creates a new version with the content from the specified version
   */
  async restoreNoteVersion(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    versionId: string,
  ): Promise<Result<Note, string>> {
    try {
      logger.info('[RestoreVersion] Backend: Starting restore', {
        workspaceId,
        noteId,
        versionId,
      });

      const noteResult = await this.getNote(workspaceId, noteId);
      if (!noteResult.ok) {
        logger.error('[RestoreVersion] Backend: Failed to get note', { error: noteResult.error });
        return noteResult;
      }

      const note = noteResult.data;
      if (!note.versions || note.versions.length === 0) {
        logger.error('[RestoreVersion] Backend: No versions available');
        return {
          ok: false,
          error: 'No versions available to restore from',
        };
      }

      logger.info('[RestoreVersion] Backend: Found note with versions', {
        versionsCount: note.versions.length,
      });

      // Find the version to restore
      const versionToRestore = note.versions.find((v) => v.versionId === versionId);
      if (!versionToRestore) {
        logger.error('[RestoreVersion] Backend: Version not found', { versionId });
        return {
          ok: false,
          error: `Version ${versionId} not found`,
        };
      }

      logger.info('[RestoreVersion] Backend: Found version to restore', {
        versionNumber: versionToRestore.versionNumber,
        contentLength: versionToRestore.content.length,
      });

      // Update the note with the restored content
      // This will automatically create a new version
      logger.info('[RestoreVersion] Backend: Calling updateNote');
      const updateResult = await this.updateNote({
        id: noteId,
        workspaceId,
        content: versionToRestore.content,
        title: versionToRestore.title,
      });

      if (updateResult.ok) {
        logger.debug('[RestoreVersion] Backend: Note restored successfully', {
          workspaceId,
          noteId,
          versionId: versionToRestore.versionId,
          versionNumber: versionToRestore.versionNumber,
          newVersionsCount: updateResult.data.versions?.length,
        });
      } else {
        logger.error('[RestoreVersion] Backend: updateNote failed', {
          error: updateResult.error,
        });
      }

      return updateResult;
    } catch (error) {
      logger.error('[RestoreVersion] Backend: Exception during restore', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to restore note version',
      };
    }
  }

  // Comment methods now use CommentsRepository directly

  /**
   * Add a comment to a note
   */
  async addComment(
    workspaceId: string,
    noteId: string,
    params: {
      id?: string; // Allow frontend to provide its own ID
      content: string;
      type: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
      author: string;
      authorType: 'user' | 'agent';
      section?: string;
      lineStart?: number;
      lineEnd?: number;
      parentId?: string;
      threadId?: string;
      tags?: string[];
      from?: number;
      to?: number;
      markId?: string;
      agentId?: string;
    },
  ): Promise<Result<NoteComment, string>> {
    logger.info('Adding comment', {
      workspaceId,
      noteId,
      type: params.type,
      author: params.author,
    });

    try {
      const existingComments = await this.commentsRepository.findByNote(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
      );
      logger.debug('Loaded existing comments', {
        workspaceId,
        noteId,
        count: existingComments.length,
      });

      // Validate and determine comment ID
      let commentId: string;
      if (params.id) {
        // Frontend provided an ID - validate it
        if (!isValidCommentId(params.id)) {
          logger.error('Invalid comment ID format provided', { id: params.id });
          return {
            ok: false,
            error: `Invalid comment ID format: ${params.id}. Must be a valid UUID.`,
          };
        }

        // Check for duplicate ID
        const isDuplicate = existingComments.some((c) => c.id === params.id);
        if (isDuplicate) {
          logger.error('Duplicate comment ID', { id: params.id });
          return {
            ok: false,
            error: `Comment ID already exists: ${params.id}`,
          };
        }

        commentId = params.id;
        logger.info('Using frontend-provided comment ID', { id: commentId });
      } else {
        // Backend generates ID (for legacy/MCP tools)
        commentId = generateCommentId();
        logger.info('Generated comment ID on backend', { id: commentId });
      }

      // Create new comment
      const now = new Date().toISOString();
      const newComment: NoteComment = {
        id: commentId,
        noteId,
        content: params.content,
        type: params.type,
        author: params.author,
        authorType: params.authorType,
        section: params.section,
        lineStart: params.lineStart,
        lineEnd: params.lineEnd,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        // Include optional fields if provided
        parentId: params.parentId,
        threadId: params.threadId,
        tags: params.tags,
        from: params.from,
        to: params.to,
        markId: params.markId,
        agentId: params.agentId,
      };

      // Add comment to the list
      existingComments.push(newComment);

      // Save updated comments
      await this.commentsRepository.save(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
        existingComments,
      );

      logger.info('Comment added successfully', {
        workspaceId,
        noteId,
        commentId,
      });

      return { ok: true, data: newComment };
    } catch (error) {
      logger.error('Failed to add comment', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to add comment: ${(error as Error).message}`,
      };
    }
  }

  /**
   * List comments for a note
   */
  async listComments(
    workspaceId: string,
    noteId: string,
    filters?: {
      status?: 'open' | 'resolved' | 'pending';
      type?: string;
      author?: string;
    },
  ): Promise<Result<NoteComment[], string>> {
    try {
      const comments = await this.commentsRepository.findByNote(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
      );

      // Apply filters if provided
      let filteredComments = comments;
      if (filters) {
        if (filters.status) {
          filteredComments = filteredComments.filter((c) => c.status === filters.status);
        }
        if (filters.type) {
          filteredComments = filteredComments.filter((c) => c.type === filters.type);
        }
        if (filters.author) {
          filteredComments = filteredComments.filter((c) => c.author === filters.author);
        }
      }

      return { ok: true, data: filteredComments };
    } catch (error) {
      logger.error('Failed to list comments', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to list comments: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Update comment status
   */
  async updateCommentStatus(
    workspaceId: string,
    noteId: string,
    commentId: string,
    status: 'open' | 'resolved' | 'pending',
  ): Promise<Result<NoteComment, string>> {
    try {
      await this.commentsRepository.update(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
        commentId,
        { status },
      );

      const updatedComment = await this.commentsRepository.findById(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
        commentId,
      );

      if (!updatedComment) {
        return {
          ok: false,
          error: 'Comment not found after update',
        };
      }

      return { ok: true, data: updatedComment };
    } catch (error) {
      logger.error('Failed to update comment status', error as Error, {
        workspaceId,
        noteId,
        commentId,
      });
      return {
        ok: false,
        error: `Failed to update comment status: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(
    workspaceId: string,
    noteId: string,
    commentId: string,
  ): Promise<Result<void, string>> {
    try {
      await this.commentsRepository.delete(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
        commentId,
      );

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to delete comment', error as Error, {
        workspaceId,
        noteId,
        commentId,
      });
      return {
        ok: false,
        error: `Failed to delete comment: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Suggest a change to a note
   */
  async suggestChange(
    workspaceId: string,
    noteId: string,
    params: {
      description: string;
      original: string;
      proposed: string;
      author: string;
      authorType: 'user' | 'agent';
      lineStart?: number;
      lineEnd?: number;
      section?: string;
      reason?: string;
      tags?: string;
    },
  ): Promise<Result<NoteComment, string>> {
    try {
      const commentId = generateCommentId();
      const now = new Date().toISOString();

      // Build content with optional reason
      let content = params.description;
      if (params.reason) {
        content = `${params.description}\n\n**Reason:** ${params.reason}`;
      }

      const suggestionComment: NoteComment = {
        id: commentId,
        noteId,
        content,
        type: 'suggestion',
        author: params.author,
        authorType: params.authorType,
        section: params.section,
        lineStart: params.lineStart,
        lineEnd: params.lineEnd,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        suggestionDiff: {
          original: params.original,
          proposed: params.proposed,
          lineStart: params.lineStart,
          lineEnd: params.lineEnd,
        },
        tags: params.tags ? [params.tags] : undefined,
      };

      await this.commentsRepository.add(
        workspaceId as WorkspaceId,
        NoteIdBrand(noteId),
        suggestionComment,
      );

      logger.info('Change suggestion added', {
        workspaceId,
        noteId,
        commentId,
      });

      return { ok: true, data: suggestionComment };
    } catch (error) {
      logger.error('Failed to suggest change', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to suggest change: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Mark a note as a task by adding task metadata
   * Phase 1A Increment 2
   */
  async markAsTask(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    taskMetadata: TaskMetadata,
  ): Promise<Result<Note, string>> {
    try {
      // Get the existing note
      const noteResult = await this.getNote(workspaceId, noteId);

      if (!noteResult.ok) {
        return noteResult;
      }

      const note = noteResult.data;
      const existingTask = note.metadata?.task;
      const isAlreadyTask = !!existingTask;
      const previousStatus = existingTask?.status;
      const newStatus = taskMetadata.status;

      // If the note is already a task and the status is changing,
      // delegate to updateTaskStatus() to emit events properly
      if (isAlreadyTask && previousStatus && newStatus && previousStatus !== newStatus) {
        logger.info('markAsTask: Status change detected, delegating to updateTaskStatus', {
          workspaceId,
          noteId,
          previousStatus,
          newStatus,
        });
        return this.updateTaskStatus(workspaceId, noteId, newStatus);
      }

      // Add timestamps if marking as in_progress or complete for the first time
      const now = new Date().toISOString();
      const enrichedTaskMetadata = { ...taskMetadata };

      // Set startedAt if marking as in_progress and not already set
      if (taskMetadata.status === 'in_progress' && !taskMetadata.startedAt) {
        enrichedTaskMetadata.startedAt = now;
      }

      // Set completedAt if marking as complete
      if (taskMetadata.status === 'complete') {
        enrichedTaskMetadata.completedAt = now;
      }

      // Add task metadata to the note, preserving existing metadata
      const updatedMetadata = {
        ...note.metadata,
        task: enrichedTaskMetadata,
      };

      // Update the note with the new metadata
      const updateResult = await this.updateNote({
        workspaceId,
        id: noteId,
        metadata: updatedMetadata,
      });

      if (!updateResult.ok) {
        return updateResult;
      }

      logger.info('Note marked as task', {
        workspaceId,
        noteId,
        status: enrichedTaskMetadata.status,
        startedAt: enrichedTaskMetadata.startedAt,
        completedAt: enrichedTaskMetadata.completedAt,
      });

      return { ok: true, data: updateResult.data };
    } catch (error) {
      logger.error('Failed to mark note as task', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to mark note as task: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Update the status of a task
   * Automatically sets startedAt when status changes to 'in_progress' (first time)
   * Automatically sets completedAt when status changes to 'complete'
   *
   * Status workflow: not_started → in_progress ↔ review_required → complete
   * Special states: blocked, discussion_needed, cancelled
   */
  async updateTaskStatus(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    status: TaskStatus,
  ): Promise<Result<Note, string>> {
    try {
      // Get the existing note
      const noteResult = await this.getNote(workspaceId, noteId);
      if (!noteResult.ok) {
        return noteResult;
      }

      const note = noteResult.data;

      // Check if note is a task
      if (!note.metadata?.task) {
        return {
          ok: false,
          error: 'Note is not a task. Use markAsTask() first.',
        };
      }

      const currentTask = note.metadata.task;
      const now = new Date().toISOString();

      // Build updated task metadata
      const updatedTask: TaskMetadata = {
        ...currentTask,
        status,
      };

      // Set startedAt timestamp if transitioning to in_progress and not already set
      if (status === 'in_progress' && !currentTask.startedAt) {
        updatedTask.startedAt = now;
      }

      // Set completedAt timestamp if transitioning to complete (first time only)
      if (status === 'complete' && !currentTask.completedAt) {
        updatedTask.completedAt = now;
      }

      // Clear completedAt if moving away from complete status
      if (status !== 'complete' && currentTask.completedAt) {
        updatedTask.completedAt = undefined;
      }

      // Update the note with the new task metadata
      const updateResult = await this.updateNote({
        workspaceId,
        id: noteId,
        metadata: {
          ...note.metadata,
          task: updatedTask,
        },
      });

      if (!updateResult.ok) {
        return updateResult;
      }

      const previousStatus = currentTask.status;

      logger.info('Task status updated', {
        workspaceId,
        noteId,
        oldStatus: previousStatus,
        newStatus: status,
      });

      // Emit task:status-changed event (only if status actually changed)
      if (previousStatus !== status) {
        // Get current actor for provenance (agent or user)
        const provenanceManager = getProvenanceContextManager();
        const currentActor = provenanceManager.getCurrentActor();

        // Emit via Redux (persisted + broadcast by workspace-events sagas)
        // Convert actor to EventActor (getCurrentActor returns loosely typed object)
        const actor = currentActor
          ? {
              type: currentActor.type as 'user' | 'agent' | 'system',
              id: currentActor.id,
              name: currentActor.name,
            }
          : { type: 'system' as const, id: 'system', name: 'System' };
        const statusChangedEvent = createWorkspaceEvent('task:status-changed', workspaceId, actor, {
          noteId,
          noteTitle: note.title,
          previousStatus,
          newStatus: status,
          changedAt: now,
          agentId: currentActor?.type === 'agent' ? currentActor.id : undefined,
        });
        mainDispatch(reduxEmitWorkspaceEvent(statusChangedEvent));

        logger.debug('Emitted task:status-changed event via Redux', {
          workspaceId,
          noteId,
          previousStatus,
          newStatus: status,
        });

        // Compute and emit ready tasks changed event
        await this.emitReadyTasksChanged(workspaceId, actor, {
          noteId,
          previousStatus,
          newStatus: status,
        });
      }

      return { ok: true, data: updateResult.data };
    } catch (error) {
      logger.error('Failed to update task status', error as Error, {
        workspaceId,
        noteId,
        status,
      });
      return {
        ok: false,
        error: `Failed to update task status: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Update the peerOrder of a task (for reordering among siblings)
   * peerOrder determines the order of tasks with the same parentId
   * Uses fractional indexing (gaps of 100) for easy insertion
   */
  async updateTaskPeerOrder(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    peerOrder: number,
  ): Promise<Result<Note, string>> {
    try {
      // Get the existing note
      const noteResult = await this.getNote(workspaceId, noteId);
      if (!noteResult.ok) {
        return noteResult;
      }

      const note = noteResult.data;

      // Check if note is a task
      if (!note.metadata?.task) {
        return {
          ok: false,
          error: 'Note is not a task. Use markAsTask() first.',
        };
      }

      const currentTask = note.metadata.task;

      // Build updated task metadata with new peerOrder
      const updatedTask: TaskMetadata = {
        ...currentTask,
        peerOrder,
      };

      // Update the note with the new task metadata
      const updateResult = await this.updateNote({
        workspaceId,
        id: noteId,
        metadata: {
          ...note.metadata,
          task: updatedTask,
        },
      });

      if (!updateResult.ok) {
        return updateResult;
      }

      logger.info('Task peerOrder updated', {
        workspaceId,
        noteId,
        oldPeerOrder: currentTask.peerOrder,
        newPeerOrder: peerOrder,
      });

      return { ok: true, data: updateResult.data };
    } catch (error) {
      logger.error('Failed to update task peerOrder', error as Error, {
        workspaceId,
        noteId,
        peerOrder,
      });
      return {
        ok: false,
        error: `Failed to update task peerOrder: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Remove task metadata from a note, demoting it back to a regular note
   * Phase 1A Increment 6
   */
  async removeTaskMetadata(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<Result<Note, string>> {
    try {
      // Get the existing note
      const noteResult = await this.getNote(workspaceId, noteId);
      if (!noteResult.ok) {
        return noteResult;
      }

      const note = noteResult.data;

      // Check if note is a task
      if (!note.metadata?.task) {
        return {
          ok: false,
          error: 'Note is not a task. Nothing to remove.',
        };
      }

      // Remove task metadata while preserving other metadata
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { task, ...remainingMetadata } = note.metadata;

      // Update the note with task metadata removed
      const updateResult = await this.updateNote({
        workspaceId,
        id: noteId,
        metadata: remainingMetadata,
      });

      if (!updateResult.ok) {
        return updateResult;
      }

      logger.info('Task metadata removed', {
        workspaceId,
        noteId,
      });

      return { ok: true, data: updateResult.data };
    } catch (error) {
      logger.error('Failed to remove task metadata', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to remove task metadata: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get all task notes in a workspace with optional filtering
   * Phase 1A Increment 7
   */
  async getTaskNotes(
    workspaceId: WorkspaceId,
    filters?: {
      status?: TaskStatus;
    },
  ): Promise<Result<Note[], string>> {
    try {
      // Get all notes in the workspace
      const notesResult = await this.listNotes(workspaceId);
      if (!notesResult.ok) {
        return notesResult;
      }

      // Filter to only task notes
      let taskNotes = notesResult.data.notes.filter((note) => note.metadata?.task !== undefined);

      // Apply status filter if provided
      if (filters?.status) {
        taskNotes = taskNotes.filter((note) => note.metadata?.task?.status === filters.status);
      }

      logger.info('Retrieved task notes', {
        workspaceId,
        count: taskNotes.length,
        filters,
      });

      return { ok: true, data: taskNotes };
    } catch (error) {
      logger.error('Failed to get task notes', error as Error, {
        workspaceId,
        filters,
      });
      return {
        ok: false,
        error: `Failed to get task notes: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Create a new note, mark it as a task, and add it as a dependency to an existing note
   * Phase 1B: High-level dependency creation workflow
   * Phase 1C: Enhanced with optional agent creation and assignment
   *
   * This is an atomic operation that:
   * 1. Creates a new note with the given title and content
   * 2. Marks it as a task with the specified status
   * 3. Adds it as a dependency to the target note
   * 4. Optionally creates and assigns an agent to work on the task
   *
   * @param workspaceId - The workspace ID
   * @param dependentNoteId - The note that will depend on the new note
   * @param options - Configuration for the new prerequisite note
   * @returns Result containing the created note with full metadata and optional agent
   */
  async createPrerequisiteNote(
    workspaceId: WorkspaceId,
    dependentNoteId: NoteId,
    options: {
      title: string;
      content?: string;
      taskStatus?: TaskStatus;
      peerOrder?: number; // Order among sibling tasks (uses gaps of 100)
      agentConfig?: {
        instruction?: string;
        model?: string;
        autoStart?: boolean;
        agentId?: string; // Pre-generated agent ID for optimistic UI updates
      };
    },
  ): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
    try {
      // Sanitize title to remove markdown formatting (e.g., **bold text** -> bold text)
      const sanitizedTitle = stripMarkdownFormatting(options.title);

      // Use debug level for detailed logs to reduce overhead during bulk operations
      logger.debug('Creating prerequisite note', {
        workspaceId,
        dependentNoteId,
        title: sanitizedTitle,
      });

      // Verify the dependent note exists
      const dependentResult = await this.getNote(workspaceId, dependentNoteId);
      if (!dependentResult.ok) {
        return { ok: false, error: `Dependent note not found: ${dependentNoteId}` };
      }

      // Use provided content or empty string
      const noteContent = options.content || '';

      // Step 1: Create the new note with parentId for visual nesting in sidebar
      const createResult = await this.createNote({
        workspaceId,
        title: sanitizedTitle,
        content: noteContent,
        parentId: dependentNoteId, // Set parentId so the note appears nested under its parent
      });

      if (!createResult.ok) {
        return { ok: false, error: `Failed to create note: ${createResult.error}` };
      }

      const newNote = createResult.data;
      logger.debug('Created prerequisite note', { noteId: newNote.id });

      // Step 2: Mark it as a task
      const taskStatus = options.taskStatus || 'not_started';
      const taskMetadata: TaskMetadata = {
        status: taskStatus,
      };
      if (options.peerOrder !== undefined) {
        taskMetadata.peerOrder = options.peerOrder;
      }
      const markAsTaskResult = await this.markAsTask(workspaceId, newNote.id, taskMetadata);

      if (!markAsTaskResult.ok) {
        // Rollback: delete the created note
        await this.deleteNote(newNote.id, workspaceId);
        return { ok: false, error: `Failed to mark as task: ${markAsTaskResult.error}` };
      }

      logger.debug('Marked prerequisite note as task', { noteId: newNote.id, status: taskStatus });

      // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph.
      // The parentId was already set when creating the note (line 1772), so no separate
      // dependency tracking is needed. The old addDependency call has been removed.

      let taskNote = markAsTaskResult.data;
      let agentSession: AgentSession | null = null;

      // Step 4: Create and assign agent if requested
      if (options.agentConfig) {
        try {
          logger.debug('Creating agent for task', {
            noteId: taskNote.id,
            title: options.title,
          });

          // Build initial message for the agent
          const initialMessage = buildTaskAgentInitialMessage(
            taskNote,
            options.agentConfig.instruction,
          );

          // Get workspace for agent creation
          const workspaceResult = await workspaceService.getWorkspace(workspaceId);
          if (!workspaceResult.ok) {
            logger.warn('Could not get workspace for agent creation', {
              workspaceId,
              error: workspaceResult.error,
            });
          } else {
            const workspace = workspaceResult.data;

            // Generate agent name from task title
            const agentName = generateAgentNameFromTask(options.title);

            // Create agent via AgentBackendHandler
            // IMPORTANT: Pass agentId as 4th parameter, not inside config
            agentSession = await agentBackendHandler.createAgent(
              workspaceId,
              agentName,
              {
                workspacePath: workspace.path,
                agentType: 'task-loop', // Pass at top level for system prompt building
                initialMessage,
                model: options.agentConfig.model,
                metadata: {
                  source: 'task-creation',
                  agentType: 'task-loop', // Also keep in metadata for tracking
                  taskNoteId: taskNote.id,
                  isBackground: true, // Task agents run in the background
                },
              },
              options.agentConfig.agentId, // Use pre-generated ID for optimistic UI
            );

            if (agentSession) {
              // Use debug level for detailed logs to reduce overhead during bulk operations
              logger.debug('Agent created successfully', {
                noteId: taskNote.id,
                agentId: agentSession.id,
                agentName: agentSession.name,
              });

              // Step 5: Assign agent to task
              // IMPORTANT: We already have taskNote with task metadata in memory.
              // Don't call assignAgentToTask() which re-reads the note from storage
              // (can cause race condition where the task metadata isn't persisted yet).
              // Instead, directly update the note we have.
              const currentAgents = taskNote.metadata?.task?.assignedAgentIds || [];
              const updatedAgents = [...currentAgents, agentSession.id];

              const assignResult = await this.updateNote({
                workspaceId,
                id: taskNote.id,
                metadata: {
                  ...taskNote.metadata,
                  task: {
                    ...taskNote.metadata!.task!,
                    assignedAgentIds: updatedAgents,
                  },
                },
              });

              if (!assignResult.ok) {
                logger.warn('Agent created but assignment failed', {
                  noteId: taskNote.id,
                  agentId: agentSession.id,
                  error: assignResult.error,
                });
                // Don't fail entire operation - agent exists, user can assign manually
              } else {
                // Update taskNote with assigned agent
                taskNote = assignResult.data;
                logger.debug('Agent assigned to task', {
                  workspaceId,
                  noteId: taskNote.id,
                  agentId: agentSession.id,
                  totalAgents: updatedAgents.length,
                });

                // If task status is 'in_progress', call updateTaskStatus to set startedAt timestamp
                // and emit proper events
                if (taskStatus === 'in_progress') {
                  const statusUpdateResult = await this.updateTaskStatus(
                    workspaceId,
                    taskNote.id,
                    'in_progress',
                  );
                  if (statusUpdateResult.ok) {
                    taskNote = statusUpdateResult.data;
                    logger.debug('Task status updated to in_progress with timestamp', {
                      noteId: taskNote.id,
                    });
                  } else {
                    logger.warn('Failed to update task status timestamp', {
                      noteId: taskNote.id,
                      error: statusUpdateResult.error,
                    });
                  }
                }
              }
            } else {
              logger.warn('Agent creation returned null', {
                noteId: taskNote.id,
                agentName,
              });
            }
          }
        } catch (error) {
          // Graceful degradation - log warning but don't fail
          logger.warn('Failed to create agent for task', {
            noteId: taskNote.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Task creation succeeded, agent creation failed - acceptable
        }
      }

      // Return the created note with its task metadata and optional agent
      return {
        ok: true,
        data: { note: taskNote, agent: agentSession ?? undefined },
      };
    } catch (error) {
      logger.error('Error creating prerequisite note', error as Error, {
        workspaceId,
        dependentNoteId,
        title: options.title,
      });
      return {
        ok: false,
        error: `Failed to create prerequisite note: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get children of a note (notes that have this note as their parent)
   * Used for task orchestration - when children complete, parent may be ready
   */
  async getChildren(workspaceId: WorkspaceId, noteId: NoteId): Promise<Result<Note[], string>> {
    try {
      logger.info('Getting children for note', {
        workspaceId,
        noteId,
      });

      // Get all notes in the workspace
      const allNotesResult = await this.listNotes(workspaceId);
      if (!allNotesResult.ok) {
        return { ok: false, error: allNotesResult.error };
      }

      // Find all notes that have this note as their parent
      const children = allNotesResult.data.notes.filter((n) => n.parentId === noteId);

      logger.info('Retrieved children', {
        workspaceId,
        noteId,
        count: children.length,
        childIds: children.map((c) => c.id),
      });

      return { ok: true, data: children };
    } catch (error) {
      logger.error('Failed to get children', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to get children: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Compute and emit ready tasks changed event.
   * Called after a task status changes to broadcast the updated list of ready tasks.
   */
  private async emitReadyTasksChanged(
    workspaceId: WorkspaceId,
    actor: EventActor,
    triggeredBy?: {
      noteId: string;
      previousStatus: string;
      newStatus: string;
    },
  ): Promise<void> {
    try {
      // Compute the ready tasks using existing method
      const readyTasksResult = await this.findReadyTasks(workspaceId);
      if (!readyTasksResult.ok) {
        logger.warn('Failed to compute ready tasks', {
          workspaceId,
          error: readyTasksResult.error,
        });
        return;
      }

      const readyTaskIds = readyTasksResult.data.ready.map((note) => note.id);
      const now = new Date().toISOString();

      // Create and emit the event via Redux
      const readyTasksChangedEvent = createWorkspaceEvent(
        'task:ready-tasks-changed',
        workspaceId,
        actor,
        {
          readyTaskIds,
          triggeredBy,
          computedAt: now,
        },
      );

      mainDispatch(reduxEmitWorkspaceEvent(readyTasksChangedEvent));

      logger.debug('Emitted task:ready-tasks-changed event via Redux', {
        workspaceId,
        readyTaskCount: readyTaskIds.length,
        triggeredBy,
      });
    } catch (error) {
      logger.error('Error in emitReadyTasksChanged', error as Error, {
        workspaceId,
      });
    }
  }

  /**
   * Find the next task to work on using DFS with dependency satisfaction.
   *
   * Algorithm:
   * 1. Start from the given root task
   * 2. Get all child tasks (notes with parentId = rootNoteId that are tasks)
   * 3. Filter out terminal tasks (complete, cancelled)
   * 4. Sort children: leaves first (no children), then by peerOrder
   * 5. For each child, recursively find the next task
   * 6. If no children or all children are terminal, return the root task if it's ready
   *
   * A task is "ready" if:
   * - It's not in a terminal status (complete, cancelled)
   * - All its dependencies are complete
   *
   * @param workspaceId - Workspace ID
   * @param rootNoteId - The root task note to start searching from
   * @returns The next task to work on, or null if no tasks are ready
   */
  async findNextTask(
    workspaceId: WorkspaceId,
    rootNoteId: NoteId,
  ): Promise<Result<Note | null, string>> {
    try {
      logger.info('Finding next task', { workspaceId, rootNoteId });

      // Get the root note
      const rootResult = await this.getNote(workspaceId, rootNoteId);
      if (!rootResult.ok) {
        return { ok: false, error: `Root note not found: ${rootNoteId}` };
      }

      const rootNote = rootResult.data;

      // Check if root is a task
      if (!rootNote.metadata?.task) {
        return { ok: false, error: `Note ${rootNoteId} is not a task` };
      }

      // Helper to check if a task status is terminal
      const isTerminalStatus = (status: TaskStatus): boolean =>
        status === 'complete' || status === 'cancelled';

      // If root task is terminal, nothing to do
      if (isTerminalStatus(rootNote.metadata.task.status)) {
        logger.info('Root task is terminal', {
          workspaceId,
          rootNoteId,
          status: rootNote.metadata.task.status,
        });
        return { ok: true, data: null };
      }

      // Get all notes in workspace to find children
      const allNotesResult = await this.listNotes(workspaceId);
      if (!allNotesResult.ok) {
        return { ok: false, error: allNotesResult.error };
      }

      const allNotes = allNotesResult.data.notes;

      // Helper to get child task notes for a given parent
      const getChildTasks = (parentId: NoteId): Note[] =>
        allNotes
          .filter(
            (n) =>
              n.parentId === parentId &&
              n.metadata?.task &&
              !isTerminalStatus(n.metadata.task.status),
          )
          .sort((a, b) => {
            // Leaves first (notes with no children)
            const aHasChildren = allNotes.some((n) => n.parentId === a.id);
            const bHasChildren = allNotes.some((n) => n.parentId === b.id);
            if (aHasChildren !== bHasChildren) {
              return aHasChildren ? 1 : -1; // Leaves (no children) come first
            }
            // Then by peerOrder
            const aPeerOrder = a.metadata?.task?.peerOrder ?? 0;
            const bPeerOrder = b.metadata?.task?.peerOrder ?? 0;
            if (aPeerOrder !== bPeerOrder) {
              return aPeerOrder - bPeerOrder;
            }
            // Fallback: older tasks first (by createdAt)
            const aCreated = a.createdAt || a.created_at || '';
            const bCreated = b.createdAt || b.created_at || '';
            return aCreated.localeCompare(bCreated);
          });

      // Recursive DFS to find next task
      // Note: Task dependencies are now represented by parent/child hierarchy.
      // A task is ready when all its children (subtasks) are complete.
      const findNextTaskRecursive = async (note: Note): Promise<Note | null> => {
        // Get children of this task
        const children = getChildTasks(note.id);

        // If no children, this is a leaf - it's ready to work on
        if (children.length === 0) {
          logger.debug('Found ready leaf task', {
            noteId: note.id,
            title: note.title,
          });
          return note;
        }

        // DFS through children
        for (const child of children) {
          const result = await findNextTaskRecursive(child);
          if (result) {
            return result;
          }
        }

        // All children are blocked or terminal
        // Check if this task itself is ready (all children done)
        const allChildrenTerminal = allNotes
          .filter((n) => n.parentId === note.id && n.metadata?.task)
          .every((n) => isTerminalStatus(n.metadata!.task!.status));

        if (allChildrenTerminal) {
          logger.debug('Found ready parent task (all children complete)', {
            noteId: note.id,
            title: note.title,
          });
          return note;
        }

        return null;
      };

      const nextTask = await findNextTaskRecursive(rootNote);

      logger.info('Find next task result', {
        workspaceId,
        rootNoteId,
        foundTask: nextTask ? { id: nextTask.id, title: nextTask.title } : null,
      });

      return { ok: true, data: nextTask };
    } catch (error) {
      logger.error('Failed to find next task', error as Error, {
        workspaceId,
        rootNoteId,
      });
      return {
        ok: false,
        error: `Failed to find next task: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Find all tasks that are ready to be worked on.
   *
   * Uses the findReadyTasks utility which returns tasks that:
   * 1. Are not in a terminal status (complete, cancelled)
   * 2. Have all dependencies complete
   *
   * @param workspaceId - Workspace ID
   * @returns Object with flattened task tree and ready tasks
   */
  async findReadyTasks(
    workspaceId: WorkspaceId,
  ): Promise<Result<{ flattened: Note[]; ready: Note[] }, string>> {
    try {
      logger.info('Finding ready tasks', { workspaceId });

      // PERF: Use listNotes with skipSort since findReadyTasks does its own ordering.
      // This avoids the expensive sort of all notes.
      const allNotesResult = await this.listNotes(workspaceId, { skipSort: true });
      if (!allNotesResult.ok) {
        return { ok: false, error: allNotesResult.error };
      }

      // Import and use the utilities
      const { findReadyTasks, flattenTaskTree } = await import('../utils/task-tree-utils');
      const allNotes = allNotesResult.data.notes;
      const flattenedTasks = flattenTaskTree(allNotes);
      const readyTasks = findReadyTasks(flattenedTasks, allNotes);

      logger.info('Found ready tasks', {
        workspaceId,
        flattenedCount: flattenedTasks.length,
        readyCount: readyTasks.length,
        flattenedIds: flattenedTasks.map((t) => t.id),
        readyIds: readyTasks.map((t) => t.id),
      });

      return { ok: true, data: { flattened: flattenedTasks, ready: readyTasks } };
    } catch (error) {
      logger.error('Failed to find ready tasks', error as Error, { workspaceId });
      return {
        ok: false,
        error: `Failed to find ready tasks: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Assign an agent to a task note
   * Phase 1C: Agent assignment
   *
   * @param workspaceId - Workspace ID
   * @param noteId - Note ID (must be a task)
   * @param agentId - Agent ID to assign
   * @returns Updated note with agent assigned
   */
  async assignAgentToTask(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    agentId: AgentId,
  ): Promise<Result<Note, string>> {
    try {
      logger.info('Assigning agent to task', {
        workspaceId,
        noteId,
        agentId,
      });

      // Get the note
      const noteResult = await this.getNote(workspaceId, noteId);
      if (!noteResult.ok) {
        return { ok: false, error: `Note not found: ${noteId}` };
      }

      const note = noteResult.data;

      // Verify it's a task
      if (!note.metadata?.task) {
        return { ok: false, error: `Note ${noteId} is not a task` };
      }

      // Get current assigned agents (or empty array)
      const currentAgents = note.metadata.task.assignedAgentIds || [];
      const currentStatus = note.metadata.task.status;

      // Check if agent is already assigned
      const isAgentAlreadyAssigned = currentAgents.includes(agentId);

      // Determine if we should update status to in_progress
      // Update status if task is currently not_started (regardless of whether agent is already assigned)
      const shouldUpdateStatus = currentStatus === 'not_started';

      // If agent is already assigned and status doesn't need updating, nothing to do
      if (isAgentAlreadyAssigned && !shouldUpdateStatus) {
        logger.info('Agent already assigned and status is correct, skipping', {
          workspaceId,
          noteId,
          agentId,
          currentStatus,
        });
        return { ok: true, data: note };
      }

      // Update agent assignment if needed
      let updatedNote = note;
      if (!isAgentAlreadyAssigned) {
        const updatedAgents = [...currentAgents, agentId];

        const updateResult = await this.updateNote({
          workspaceId,
          id: noteId,
          metadata: {
            ...note.metadata,
            task: {
              ...note.metadata.task,
              assignedAgentIds: updatedAgents,
            },
          },
        });

        if (!updateResult.ok) {
          return { ok: false, error: updateResult.error };
        }

        updatedNote = updateResult.data;

        logger.info('Agent assigned to task', {
          workspaceId,
          noteId,
          agentId,
          totalAgents: updatedAgents.length,
        });
      }

      // Update status to in_progress if needed (this sets startedAt timestamp and emits events)
      if (shouldUpdateStatus) {
        const statusUpdateResult = await this.updateTaskStatus(workspaceId, noteId, 'in_progress');
        if (statusUpdateResult.ok) {
          logger.info('Task status updated to in_progress', {
            workspaceId,
            noteId,
            agentId,
          });
          return { ok: true, data: statusUpdateResult.data };
        }
        // If status update fails, still return the agent assignment success
        logger.warn('Agent assigned but status update failed', {
          workspaceId,
          noteId,
          error: statusUpdateResult.error,
        });
      }

      return { ok: true, data: updatedNote };
    } catch (error) {
      logger.error('Failed to assign agent to task', error as Error, {
        workspaceId,
        noteId,
        agentId,
      });
      return {
        ok: false,
        error: `Failed to assign agent to task: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Remove an agent from all tasks in a workspace
   * Called when an agent is deleted to clean up references
   *
   * @param workspaceId - Workspace ID
   * @param agentId - Agent ID to remove from all tasks
   * @returns Number of notes that were updated
   */
  async removeAgentFromAllTasks(
    workspaceId: WorkspaceId,
    agentId: AgentId,
  ): Promise<Result<number, string>> {
    try {
      logger.info('Removing agent from all tasks', {
        workspaceId,
        agentId,
      });

      // Get all notes in the workspace
      const notesResult = await this.listNotes(workspaceId);
      if (!notesResult.ok) {
        return { ok: false, error: notesResult.error };
      }

      let updatedCount = 0;

      // Find and update notes that have this agent assigned
      for (const note of notesResult.data.notes) {
        const assignedAgentIds = note.metadata?.task?.assignedAgentIds;
        if (assignedAgentIds?.includes(agentId)) {
          // Remove the agent from the array
          const updatedAgents = assignedAgentIds.filter((id: AgentId) => id !== agentId);

          // Update the note
          const updateResult = await this.updateNote({
            workspaceId,
            id: note.id as NoteId,
            metadata: {
              ...note.metadata,
              task: {
                ...note.metadata!.task!,
                assignedAgentIds: updatedAgents,
              },
            },
          });

          if (updateResult.ok) {
            updatedCount++;
          } else {
            logger.warn('Failed to remove agent from task', {
              noteId: note.id,
              agentId,
              error: updateResult.error,
            });
          }
        }
      }

      logger.info('Agent removed from tasks', {
        workspaceId,
        agentId,
        updatedCount,
      });

      return { ok: true, data: updatedCount };
    } catch (error) {
      logger.error('Failed to remove agent from tasks', error as Error, {
        workspaceId,
        agentId,
      });
      return {
        ok: false,
        error: `Failed to remove agent from tasks: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Convert ```task blocks to linked Task Notes
   *
   * Finds all ```task blocks in the note, creates Task Notes for each,
   * and replaces them with linked task syntax.
   *
   * @param workspaceId - The workspace ID
   * @param noteId - The note containing @@@task blocks
   * @param options - Configuration options
   * @param options.autoStartAgents - Whether to create and start agents for each task (default: true)
   */
  async convertTaskBlocks(
    workspaceId: WorkspaceId,
    noteId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: { autoStartAgents?: boolean } = {},
  ): Promise<
    Result<
      {
        convertedCount: number;
        createdNoteIds: string[];
        updatedContent: string | null;
      },
      string
    >
  > {
    try {
      // Get the note
      const note = await this.notesRepository.findById(workspaceId, noteId as NoteId);
      if (!note) {
        return { ok: false, error: `Note not found: ${noteId}` };
      }

      if (!note.content) {
        return {
          ok: true,
          data: { convertedCount: 0, createdNoteIds: [], updatedContent: null },
        };
      }

      // Import the conversion utilities
      const { extractTasksBlocks, hasTaskBlocks } = await import('../utils/task-block-parser');

      // Track all created notes
      const createdNoteIds: string[] = [];
      let workingContent = note.content;

      // ===== IDEMPOTENCY CHECK: Build a map of existing child notes by title =====
      // This prevents creating duplicate notes when the agent calls this multiple times
      const allNotes = await this.notesRepository.findByWorkspace(workspaceId);
      const existingChildNotesByTitle = new Map<string, Note>();
      for (const existingNote of allNotes) {
        // Check parentId (notes have parentId directly, not in metadata)
        if (existingNote.parentId === noteId && existingNote.title) {
          // Normalize the title for comparison (lowercase, trimmed)
          const normalizedTitle = existingNote.title.trim().toLowerCase();
          existingChildNotesByTitle.set(normalizedTitle, existingNote);
        }
      }
      logger.debug('Found existing child notes for idempotency check', {
        noteId,
        existingChildCount: existingChildNotesByTitle.size,
      });

      // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph.
      // We create child notes with parentId set, which is sufficient for task orchestration.
      // No separate dependency tracking is needed.

      // Helper function to find or create a task note (with idempotency checking)
      const findOrCreateTaskNote = async (
        title: string,
        content: string,
        peerOrder: number,
      ): Promise<{ noteId: string; wasExisting: boolean } | null> => {
        const normalizedTitle = title.trim().toLowerCase();
        const existingNote = existingChildNotesByTitle.get(normalizedTitle);

        if (existingNote) {
          logger.debug('Found existing task note, skipping creation', {
            title,
            existingNoteId: existingNote.id,
          });
          return { noteId: existingNote.id as string, wasExisting: true };
        }

        // Create new task note using createPrerequisiteNote (which uses parentId for hierarchy)
        const result = await this.createPrerequisiteNote(workspaceId, noteId as NoteId, {
          title,
          content,
          taskStatus: 'not_started',
          peerOrder,
        });

        if (result.ok) {
          const newNoteId = result.data.note.id;
          // Add to the map to prevent duplicates within this call
          existingChildNotesByTitle.set(normalizedTitle, result.data.note);
          return { noteId: newNoteId, wasExisting: false };
        } else {
          logger.warn('Failed to create task note', { title, error: result.error });
          return null;
        }
      };

      // ===== STEP 1: Process ```task blocks =====
      if (hasTaskBlocks(workingContent)) {
        const tasksBlockResult = extractTasksBlocks(workingContent);

        if (tasksBlockResult.validTaskCount > 0) {
          logger.info('Converting task blocks', {
            workspaceId,
            noteId,
            blockCount: tasksBlockResult.blockCount,
            validTaskCount: tasksBlockResult.validTaskCount,
            invalidBlockCount: tasksBlockResult.invalidBlockCount,
          });

          // Create Task Notes for each task in the blocks (with idempotency)
          // Each task gets its own indexed placeholder replacement
          let peerOrder = 100;
          workingContent = tasksBlockResult.contentWithoutBlocks;

          for (let i = 0; i < tasksBlockResult.tasks.length; i++) {
            const task = tasksBlockResult.tasks[i];

            // Build content for the task note (title as h1 + body content)
            const taskNoteContent = task.content
              ? `# ${task.title}\n\n${task.content}`
              : `# ${task.title}\n\nCreated as a prerequisite task.`;

            // Use findOrCreateTaskNote to prevent duplicates
            const findResult = await findOrCreateTaskNote(task.title, taskNoteContent, peerOrder);

            if (findResult) {
              const { noteId: taskNoteId, wasExisting } = findResult;
              if (!wasExisting) {
                createdNoteIds.push(taskNoteId);
              }

              // Replace this task's indexed placeholder with its linked task line
              const linkedTaskLine = `- [ ] ${taskNoteLink(task.title, taskNoteId)}`;
              workingContent = workingContent.replace(
                `<!-- task-block-placeholder-${i} -->`,
                linkedTaskLine,
              );

              logger.debug('Task Note from task block', {
                title: task.title,
                taskNoteId,
                peerOrder,
                wasExisting,
                hasContent: !!task.content,
                placeholderIndex: i,
              });
            }

            peerOrder += 100;
          }
        }
      }

      // Clean up blank lines between consecutive linked task lines
      // This happens when task blocks had blank lines between them
      // Pattern: linked task line, blank line(s), linked task line -> collapse to no blank lines
      let cleanedContent = workingContent.replace(
        /(- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\))\n\n+(- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\))/g,
        '$1\n$2',
      );

      // Repeat to handle multiple consecutive blank lines between task items
      while (cleanedContent !== workingContent) {
        workingContent = cleanedContent;
        cleanedContent = workingContent.replace(
          /(- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\))\n\n+(- \[[ x]\] \[[^\]]+\]\(workspaces:\/\/local\/task\/[^)]+\))/g,
          '$1\n$2',
        );
      }

      const updatedContent = cleanedContent;
      const contentChanged = updatedContent !== note.content;

      // Check if anything was converted or content was updated
      // (content can change even when reusing existing notes via idempotency)
      if (!contentChanged && createdNoteIds.length === 0) {
        return {
          ok: true,
          data: { convertedCount: 0, createdNoteIds: [], updatedContent: null },
        };
      }

      // Update the parent note with new content
      // Note: Task orchestration now uses parentId, so we don't need to track dependencies here
      const now = new Date().toISOString();
      const updatedNote: Note = {
        ...note,
        content: updatedContent,
        updatedAt: now,
        metadata: {
          ...note.metadata,
          wordCount: this.countWords(updatedContent),
          characterCount: updatedContent.length,
        },
      };

      // Add a version for this update
      if (!updatedNote.versions) {
        updatedNote.versions = [];
      }
      updatedNote.versions.push({
        versionId: randomUUID(),
        versionNumber: updatedNote.versions.length + 1,
        content: updatedContent,
        title: updatedNote.title,
        author: {
          id: 'system',
          name: 'System',
          type: AuthorType.System,
        },
        createdAt: now,
        changeSummary: 'Converted task blocks to linked Task Notes',
      });

      // Prune old versions if needed
      if (updatedNote.versions.length > MAX_VERSIONS_PER_NOTE) {
        const versionsToRemove = updatedNote.versions.length - MAX_VERSIONS_PER_NOTE;
        updatedNote.versions = updatedNote.versions.slice(versionsToRemove);
      }

      // Save the updated note
      await this.notesRepository.save(updatedNote);

      if (this.crdtEnabled) {
        await crdtDocumentManager.updateContent(updatedNote.workspaceId, updatedNote.id, updatedNote.content);
      }

      // Emit note:updated and note:content-changed to workspace renderer windows with source='agent'
      // This triggers UI refresh and bypasses hasUserEditedSinceLastSave check
      try {
        const { sendToWorkspaceWindows } = await import('../../system/main/system.ipc');
        sendToWorkspaceWindows(workspaceId, 'note:updated', {
          noteId,
          content: updatedContent,
          source: 'agent',
          workspaceId,
        });
        sendToWorkspaceWindows(workspaceId, `note:content-changed:${workspaceId}`, {
          noteId,
          content: updatedContent,
          source: 'agent',
          workspaceId,
        });
      } catch (emitError) {
        logger.warn('Failed to emit note content update events', { error: (emitError as Error).message });
      }

      logger.info('Task blocks converted successfully', {
        workspaceId,
        noteId,
        convertedCount: createdNoteIds.length,
        createdNoteIds,
        contentChanged,
      });

      return {
        ok: true,
        data: {
          convertedCount: createdNoteIds.length,
          createdNoteIds,
          updatedContent: contentChanged ? updatedContent : null,
        },
      };
    } catch (error) {
      logger.error('Failed to convert task blocks', error as Error, {
        workspaceId,
        noteId,
      });
      return {
        ok: false,
        error: `Failed to convert task blocks: ${(error as Error).message}`,
      };
    }
  }
}

// Export singleton instance
export const notesService = new NotesService();

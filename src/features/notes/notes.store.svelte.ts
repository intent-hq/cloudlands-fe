/**
 * Notes State Manager
 *
 * Centralized state management for notes with proper Svelte 5 reactivity.
 * Handles all note operations, synchronization, and external updates.
 */

import type {
  Note,
  NoteId,
  WorkspaceId,
  Result,
  CreateNoteRequest,
  UpdateNoteRequest,
} from '$shared/types';
import { AuthorType, ContentType, NoteVisibility } from '$shared/types';
import { notesClient } from './notes.client';
import { listenSync } from '$lib/electron-bridge';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { Logger } from '$shared/logger';
import { NotesPrimitivesSerializer } from './notes-primitives-serializer';
import type { NotePrimitive } from '$shared/types/notes-primitives';
import { noteReadTrackingStore } from '$lib/stores/note-read-tracking.store.svelte';

const logger = new Logger('NotesStore');

interface SaveOperation {
  noteId: NoteId;
  timeoutId: ReturnType<typeof setTimeout>;
  pendingUpdates: Partial<Note>;
  originalNote: Note;
}

class NotesStore {
  // Core state
  #notes = $state<Map<NoteId, Note>>(new Map());
  #selectedNoteId: NoteId | null = $state(null);
  #workspaceId: WorkspaceId | null = $state(null);
  #loading = $state(false);
  #error: string | null = $state(null);
  #notesVersion = $state(0); // Version counter to force reactivity

  // Editor state
  #isUserTyping = $state(false);
  #lastUserInputTime = $state(0);
  #editorHasFocus = $state(false);
  #newlyCreatedNoteId: NoteId | null = $state(null);

  // Save management
  #saveOperations = new Map<NoteId, SaveOperation>();
  #saveDebounceMs = 2000;

  // Track last saved state to prevent unnecessary saves
  #lastSavedState = new Map<NoteId, string>();

  // Event listeners
  #eventUnsubscribers: (() => void)[] = [];

  // Primitives serializer
  #primitivesSerializer = new NotesPrimitivesSerializer();

  // Getters - expose the Map directly for reactivity
  get notes() {
    return this.#notes;
  }

  // Helper method to update the Map and trigger reactivity
  #updateNotesMap(updater: (map: Map<NoteId, Note>) => void) {
    const oldSize = this.#notes.size;
    const newMap = new Map(this.#notes);
    updater(newMap);
    this.#notes = newMap;
    this.#notesVersion++; // Increment version to force reactivity
    logger.debug('Notes map updated', {
      oldSize,
      newSize: newMap.size,
      mapChanged: oldSize !== newMap.size,
      version: this.#notesVersion,
    });
  }

  get spec() {
    return this.#notes.get(SPEC_NOTE_ID);
  }

  get selectedNote() {
    return this.#selectedNoteId ? this.#notes.get(this.#selectedNoteId) : null;
  }

  get selectedNoteId() {
    return this.#selectedNoteId;
  }

  get workspaceId() {
    return this.#workspaceId;
  }

  get loading() {
    return this.#loading;
  }

  get error() {
    return this.#error;
  }

  get isUserTyping() {
    return this.#isUserTyping;
  }

  get editorHasFocus() {
    return this.#editorHasFocus;
  }

  get newlyCreatedNoteId() {
    return this.#newlyCreatedNoteId;
  }

  get notesVersion() {
    return this.#notesVersion;
  }

  // Derived state
  get sortedNotes() {
    return Array.from(this.#notes.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  get pinned() {
    return Array.from(this.#notes.values()).filter((note) => note.isPinned);
  }

  get archived() {
    return Array.from(this.#notes.values()).filter((note) => note.isArchived);
  }

  get active() {
    return Array.from(this.#notes.values()).filter((note) => !note.isArchived);
  }

  get isEmpty() {
    return this.#notes.size === 0;
  }

  get count() {
    return this.#notes.size;
  }

  /**
   * Initialize for a workspace
   * @param workspaceId - The workspace ID to initialize for
   * @param initialSelectedNoteId - Optional initial note to select (preserves URL state)
   */
  async initialize(workspaceId: WorkspaceId, initialSelectedNoteId?: NoteId | null) {
    logger.debug('initialize() called', { workspaceId, initialSelectedNoteId });

    // Set workspace ID immediately for synchronous access
    const previousWorkspaceId = this.#workspaceId;
    this.#workspaceId = workspaceId;

    if (previousWorkspaceId === workspaceId) {
      logger.debug('Already initialized for workspace', { workspaceId });
      // Even if already initialized, ensure we have the latest data
      // This helps when switching between panels/views
      await this.reloadNotes();
      return;
    }

    logger.debug('Initializing for workspace', { workspaceId });

    // Clean up previous workspace (including event listeners)
    if (previousWorkspaceId) {
      await this.cleanup(false);
    }

    // Always clean up event listeners to prevent duplicates
    this.cleanupEventListeners();

    // Clear all state before loading new workspace
    this.#notes = new Map();
    // Preserve the selected note if provided (from URL state), otherwise reset
    this.#selectedNoteId = initialSelectedNoteId ?? null;
    this.#newlyCreatedNoteId = null;
    this.#loading = true;
    this.#error = null;

    try {
      // Check if this is an optimistic workspace
      const isOptimisticWorkspace = workspaceId.startsWith('optimistic-');

      // Load notes
      const result = await notesClient.list(workspaceId);
      if (result.ok) {
        // Create a new Map to trigger reactivity
        const newNotes = new Map<NoteId, Note>();
        result.data.forEach((note) => {
          // Validate note belongs to this workspace
          if (note.workspaceId !== workspaceId) {
            logger.error('Server returned note from different workspace!', undefined, {
              noteWorkspace: note.workspaceId,
              currentWorkspace: workspaceId,
              noteId: note.id,
            });
            return; // Skip this note
          }
          newNotes.set(note.id, note);
        });

        // For optimistic workspaces, create a placeholder spec note if it doesn't exist
        if (isOptimisticWorkspace && !newNotes.has(SPEC_NOTE_ID)) {
          const now = new Date().toISOString();
          const placeholderSpec: Note = {
            id: SPEC_NOTE_ID,
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
            },
            references: [],
            versions: [],
            createdAt: now,
            updatedAt: now,
            created_at: now,
            updated_at: now,
            is_pinned: true,
            is_archived: false,
          };
          newNotes.set(SPEC_NOTE_ID, placeholderSpec);
          logger.info('Created placeholder spec note for optimistic workspace', { workspaceId });
        }

        this.#notes = newNotes;

        // Only auto-select spec note if no note is currently selected
        // This preserves the URL state when loading a workspace
        if (this.#notes.has(SPEC_NOTE_ID) && !this.#selectedNoteId) {
          this.#selectedNoteId = SPEC_NOTE_ID;
        } else if (this.#selectedNoteId && !this.#notes.has(this.#selectedNoteId)) {
          // Clear selection if the selected note doesn't exist
          logger.debug('Selected note not found in workspace, clearing selection', {
            selectedNoteId: this.#selectedNoteId,
            workspaceId,
          });
          this.#selectedNoteId = null;
        }
      } else if (isOptimisticWorkspace) {
        // For optimistic workspaces, even if the list fails, create a placeholder spec note
        const now = new Date().toISOString();
        const newNotes = new Map<NoteId, Note>();
        const placeholderSpec: Note = {
          id: SPEC_NOTE_ID,
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
          },
          references: [],
          versions: [],
          createdAt: now,
          updatedAt: now,
          created_at: now,
          updated_at: now,
          is_pinned: true,
          is_archived: false,
        };
        newNotes.set(SPEC_NOTE_ID, placeholderSpec);
        this.#notes = newNotes;

        // Auto-select spec note
        if (!this.#selectedNoteId) {
          this.#selectedNoteId = SPEC_NOTE_ID;
        }

        logger.info('Created placeholder spec note for optimistic workspace (after list failure)', {
          workspaceId,
          error: result.error,
        });

        // Clear the error since we've handled it for optimistic workspaces
        this.#error = null;
      } else {
        this.#error = result.error;
      }

      // Set up event listeners (synchronous for proper cleanup)
      this.setupEventListeners();
    } catch (err) {
      this.#error = err instanceof Error ? err.message : 'Failed to load notes';
    } finally {
      this.#loading = false;
    }
  }

  /**
   * Clean up event listeners
   */
  private cleanupEventListeners() {
    if (this.#eventUnsubscribers.length > 0) {
      logger.debug('Cleaning up event listeners', { count: this.#eventUnsubscribers.length });
      this.#eventUnsubscribers.forEach((unsub) => unsub());
      this.#eventUnsubscribers = [];
    }
  }

  /**
   * Set up event listeners for external updates
   * Uses listenSync for synchronous cleanup - no race conditions on unmount
   */
  private setupEventListeners() {
    logger.debug('Setting up event listeners');

    // Listen for note updates
    this.#eventUnsubscribers.push(
      listenSync('note:updated', (event) => {
        const payload = (event as any).payload || {};
        // noteId can be at top level (domain events) or inside data (workspace events)
        const noteId = payload.noteId || payload.data?.noteId;
        const workspaceId = payload.workspaceId;
        const source = typeof payload.source === 'string' ? payload.source : undefined;

        if (!noteId) {
          logger.warn('note:updated event missing noteId', { payload });
          return;
        }

        // Only process if it's for this workspace (or workspace not specified)
        if (workspaceId && this.#workspaceId && workspaceId !== this.#workspaceId) {
          logger.debug('Ignoring note:updated for different workspace', {
            noteId,
            eventWorkspace: workspaceId,
            currentWorkspace: this.#workspaceId,
          });
          return;
        }

        const updates: Partial<Note> = {};

        if (payload.content !== undefined) {
          updates.content = payload.content;
        }

        if (payload.changes && typeof payload.changes === 'object') {
          Object.assign(updates, payload.changes);
        }

        if (payload.note && typeof payload.note === 'object') {
          Object.assign(updates, payload.note);
        }

        if ('id' in updates) {
          delete (updates as any).id;
        }

        if (updates.workspaceId && updates.workspaceId !== this.#workspaceId) {
          logger.warn('Stripping workspaceId from external update', {
            noteId,
            eventWorkspace: updates.workspaceId,
            currentWorkspace: this.#workspaceId,
          });
          delete updates.workspaceId;
        }

        if (Object.keys(updates).length === 0) {
          logger.debug('note:updated event contained no usable changes, reloading note', {
            noteId,
          });
          void this.reloadNote(noteId);
          return;
        }

        logger.debug('External note update received', {
          noteId,
          fields: Object.keys(updates),
          source,
        });

        this.handleExternalUpdate(noteId, updates, source);
      }),
    );

    // Listen for note creation
    this.#eventUnsubscribers.push(
      listenSync('note:created', (event) => {
        const payload = (event as any).payload || {};
        // noteId can be at top level (domain events) or inside data (workspace events)
        const noteId = payload.noteId || payload.data?.noteId;
        const workspaceId = payload.workspaceId;

        if (workspaceId === this.#workspaceId) {
          if (noteId) {
            // Reload just the new note to avoid race conditions with note:updated
            logger.debug('Note created, reloading single note', { noteId });
            void this.reloadNote(noteId);
          } else {
            // Fallback to full reload if noteId not provided
            logger.debug('Note created (no noteId), reloading all notes');
            void this.reloadNotes();
          }
        }
      }),
    );

    // Listen for note deletion
    this.#eventUnsubscribers.push(
      listenSync('note:deleted', (event) => {
        const payload = (event as any).payload || {};
        // noteId can be at top level (domain events) or inside data (workspace events)
        const noteId = payload.noteId || payload.data?.noteId;

        if (noteId && this.#notes.has(noteId)) {
          logger.debug('Note deleted', { noteId });
          this.#updateNotesMap((map) => map.delete(noteId));

          // Clear selection if deleted note was selected
          if (this.#selectedNoteId === noteId) {
            this.#selectedNoteId = null;
          }
        }
      }),
    );
  }

  /**
   * Handle external update to a note
   *
   * PUBLIC: Can be called from components to immediately update a note
   * with data received from API responses, avoiding race conditions with IPC events
   */
  async handleExternalUpdate(noteId: NoteId, updates: Partial<Note>, origin?: string) {
    const note = this.#notes.get(noteId);
    if (!note) {
      // Note doesn't exist locally, reload all notes
      await this.reloadNotes();
      return;
    }

    // CRITICAL: Validate note belongs to current workspace
    if (note.workspaceId !== this.#workspaceId) {
      logger.error(
        'CRITICAL: Received external update for note from different workspace!',
        undefined,
        {
          noteWorkspace: note.workspaceId,
          currentWorkspace: this.#workspaceId,
          noteId,
          origin,
        },
      );
      return;
    }
    const normalizedOrigin = origin ?? 'external';

    logger.debug('[NotesStore] handleExternalUpdate invoked', {
      noteId,
      origin: normalizedOrigin,
      hasContentUpdate: updates.content !== undefined,
      updateKeys: Object.keys(updates),
    });

    // CRITICAL: Validate updates don't contain workspace ID changes
    if (updates.workspaceId && updates.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: External update attempted to change workspace ID!', undefined, {
        currentWorkspace: this.#workspaceId,
        attemptedWorkspace: updates.workspaceId,
        noteId,
        origin: normalizedOrigin,
      });
      return;
    }

    // Safety check: Prevent updating empty spec note with content from untrusted sources
    // This prevents stale events from populating a fresh workspace's spec note
    // Only file-system (FS watcher) and agent sources are trusted for this
    if (
      noteId === 'spec' &&
      note.content === '' &&
      updates.content &&
      updates.content.trim() !== '' &&
      normalizedOrigin !== 'file-system' &&
      normalizedOrigin !== 'agent'
    ) {
      logger.debug('[NotesStore] Blocked untrusted update to empty spec note (safety check)', {
        reason: 'Only file-system and agent sources can populate empty spec notes',
        currentWorkspace: this.#workspaceId,
        contentPreview: updates.content.substring(0, 50),
        origin: normalizedOrigin,
      });
      return;
    }

    // CRITICAL: Prevent clearing spec content with empty updates from external sources
    // Unless it's marked as a user action
    if (noteId === 'spec' && updates.content !== undefined && !(updates as any).isUserAction) {
      const trimmedContent = String(updates.content).trim();
      if (trimmedContent.length === 0) {
        logger.error(
          '[NotesStore] Blocked empty spec in handleExternalUpdate (not user action)',
          undefined,
          {
            noteId,
            contentLength: updates.content?.length,
            currentContentLength: note.content?.length,
            origin: normalizedOrigin,
          },
        );
        return; // Don't apply the update at all
      }
    }

    // Check if user is actively editing this note
    const isEditingThisNote = this.#selectedNoteId === noteId && this.#isUserTyping;

    if (isEditingThisNote) {
      logger.debug('[NotesStore] User is editing this note, deferring external update', {
        noteId,
        origin: normalizedOrigin,
      });
      // Defer the update until user stops typing, but always apply it eventually
      const applyDeferredUpdate = () => {
        if (!this.#isUserTyping) {
          logger.debug('[NotesStore] Applying deferred update (user stopped typing)', {
            noteId,
            origin: normalizedOrigin,
          });
          const source = normalizedOrigin === 'agent' ? 'agent' : 'external';
          this.applyNoteUpdate(noteId, updates, source);
        } else {
          // User is still typing, retry after another delay
          logger.debug('[NotesStore] User still typing, retrying deferred update', {
            noteId,
            origin: normalizedOrigin,
          });
          setTimeout(applyDeferredUpdate, 1000);
        }
      };
      setTimeout(applyDeferredUpdate, 3000);
    } else {
      // Apply update immediately
      const source = normalizedOrigin === 'agent' ? 'agent' : 'external';
      this.applyNoteUpdate(noteId, updates, source);
    }
  }

  /**
   * Apply update to a note
   */
  private applyNoteUpdate(
    noteId: NoteId,
    updates: Partial<Note>,
    source: 'user' | 'external' | 'agent',
  ) {
    const note = this.#notes.get(noteId);
    if (!note) return;

    // CRITICAL: Validate note belongs to current workspace
    if (note.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Cannot apply update to note from different workspace!', undefined, {
        noteWorkspace: note.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId,
        source,
      });
      return;
    }

    // CRITICAL: Validate updates don't change workspace ID
    logger.debug('[NotesStore] applyNoteUpdate', {
      noteId,
      source,
      updateKeys: Object.keys(updates),
    });

    if (updates.workspaceId && updates.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Attempted to change note workspace ID!', undefined, {
        currentWorkspace: this.#workspaceId,
        attemptedWorkspace: updates.workspaceId,
        noteId,
      });
      // Remove the workspace ID from updates to prevent contamination
      const { workspaceId, ...safeUpdates } = updates;
      updates = safeUpdates;
    }

    // Defense in depth: Prevent clearing spec content at the store level
    // The service layer should already prevent this, but this is an extra safeguard
    // Allow clearing if it's from user source
    if (noteId === 'spec' && updates.content === '' && source !== 'user') {
      logger.warn('[NotesStore] Preventing spec content clear at store level (non-user source)', {
        noteId,
        source,
      });
      delete updates.content;
    }

    // Create updated note
    const updatedNote = {
      ...note,
      ...updates,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    };

    // Update in map (triggers reactivity)
    this.#updateNotesMap((map) => map.set(noteId, updatedNote));

    // Notify listeners if needed
    if (source === 'external' || source === 'agent') {
      // Only notify if content was actually updated
      if (updates.content !== undefined) {
        this.notifyContentUpdate(noteId, updatedNote.content || '', source);
      }
    }
  }

  /**
   * Reload all notes from server
   */
  async reloadNotes() {
    if (!this.#workspaceId) return;

    try {
      const result = await notesClient.list(this.#workspaceId);
      if (result.ok) {
        // Update notes while preserving selection
        const previousSelectedId = this.#selectedNoteId;

        // Create a new Map to trigger reactivity
        const newNotes = new Map<NoteId, Note>();
        result.data.forEach((note) => {
          // CRITICAL: Validate all notes belong to current workspace
          if (note.workspaceId !== this.#workspaceId) {
            logger.warn('Server returned note from different workspace, skipping', {
              noteWorkspace: note.workspaceId,
              currentWorkspace: this.#workspaceId,
              noteId: note.id,
            });
            // Skip this note to prevent cross-workspace contamination
            return;
          }
          newNotes.set(note.id, note);
        });
        this.#notes = newNotes;

        // Restore selection if note still exists
        if (previousSelectedId && this.#notes.has(previousSelectedId)) {
          this.#selectedNoteId = previousSelectedId;
        } else if (!this.#selectedNoteId && this.#notes.has(SPEC_NOTE_ID)) {
          // Auto-select spec if no selection
          this.#selectedNoteId = SPEC_NOTE_ID;
        } else if (previousSelectedId && !this.#notes.has(previousSelectedId)) {
          // Clear selection if the previously selected note no longer exists
          this.#selectedNoteId = null;
        }
      }
    } catch (err) {
      logger.error('Failed to reload notes', err as Error);
    }
  }

  /**
   * Select a note
   */
  async selectNote(noteId: NoteId | null, forceRefresh = false) {
    // Log for debugging
    logger.debug('selectNote called', {
      noteId,
      currentSelectedId: this.#selectedNoteId,
      forceRefresh,
    });

    // Don't do anything if selecting the same note (unless forcing refresh)
    if (this.#selectedNoteId === noteId && !forceRefresh && noteId !== null) {
      logger.debug('Same note already selected, skipping');
      return;
    }

    // CRITICAL: Validate note belongs to current workspace if selecting a note
    if (noteId) {
      // Always fetch fresh content when selecting a different note to avoid stale data
      const isSelectingDifferentNote = this.#selectedNoteId !== noteId;

      // First check if we have the note in our cache
      let note = this.#notes.get(noteId);

      // Always fetch from server when selecting a different note, or if not in cache, or if forcing refresh
      if (!note || forceRefresh || isSelectingDifferentNote) {
        logger.debug('Fetching note content from server', {
          noteId,
          workspace: this.#workspaceId,
          previousSelectedId: this.#selectedNoteId,
          reason: !note
            ? 'not in cache'
            : forceRefresh
              ? 'force refresh'
              : 'selecting different note',
        });
        try {
          const result = await notesClient.get(this.#workspaceId!, noteId);
          if (result.ok && result.data) {
            note = result.data;
            // Update the cache with fresh data
            this.#updateNotesMap((map) => map.set(noteId, note!));
            logger.info('Note content fetched and cached in map', {
              noteId,
              contentLength: note.content?.length,
              contentPreview: note.content?.substring(0, 50),
              mapSizeBefore: this.#notes.size,
              mapSizeAfter: this.#notes.size,
            });
          } else {
            logger.warn('Failed to fetch note from server', {
              noteId,
              workspace: this.#workspaceId,
              error: !result.ok ? result.error : 'Unknown error',
            });
            return;
          }
        } catch (error) {
          logger.error('Error fetching note', error as Error, {
            noteId,
            workspace: this.#workspaceId,
          });
          return;
        }
      }

      if (!note) {
        logger.warn('Cannot select note: not found', {
          noteId,
          workspace: this.#workspaceId,
        });
        return;
      }

      if (note.workspaceId !== this.#workspaceId) {
        logger.error('CRITICAL: Cannot select note from different workspace!', undefined, {
          noteWorkspace: note.workspaceId,
          currentWorkspace: this.#workspaceId,
          noteId,
        });
        return;
      }
    }

    // Save any pending changes before switching notes
    if (this.#selectedNoteId && this.#saveOperations.has(this.#selectedNoteId)) {
      const op = this.#saveOperations.get(this.#selectedNoteId);
      if (op) {
        clearTimeout(op.timeoutId);

        // Only save if the note still exists in the current workspace
        const noteToSave = this.#notes.get(this.#selectedNoteId);
        if (noteToSave && noteToSave.workspaceId === this.#workspaceId) {
          try {
            await this.saveToServer(this.#selectedNoteId, op.pendingUpdates, this.#workspaceId);
          } catch (error) {
            logger.warn('Failed to save note when switching', {
              noteId: this.#selectedNoteId,
              error,
            });
          }
        } else {
          logger.debug('Skipping save for note - no longer in current workspace', {
            noteId: this.#selectedNoteId,
            currentWorkspace: this.#workspaceId,
          });
        }

        this.#saveOperations.delete(this.#selectedNoteId);
      }
    }

    // Update the selected note ID
    const previousId = this.#selectedNoteId;
    this.#selectedNoteId = noteId;

    logger.debug('Note selection changed', {
      previousId,
      newId: noteId,
    });

    // Clear any editor state flags when switching notes
    this.#isUserTyping = false;
    this.#editorHasFocus = false;
  }

  /**
   * Update note content (from user input)
   * @param noteId - The ID of the note to update
   * @param content - The new content
   * @param immediate - Whether to save immediately without debouncing
   * @param workspaceId - Optional workspace ID for validation
   */
  async updateNoteContent(
    noteId: NoteId,
    content: string,
    immediate = false,
    workspaceId?: WorkspaceId,
  ) {
    // Don't process if we don't have a workspace ID set
    if (!this.#workspaceId) {
      logger.warn('No workspace ID set, skipping update for note', { noteId });
      return;
    }

    // Validate workspace if provided
    if (workspaceId && workspaceId !== this.#workspaceId) {
      logger.error('Attempted to update note in wrong workspace!', undefined, {
        expected: this.#workspaceId,
        got: workspaceId,
        noteId,
      });
      return;
    }

    const note = this.#notes.get(noteId);
    if (!note) {
      logger.warn('Note not found for update', {
        noteId,
        workspace: this.#workspaceId,
      });
      return;
    }

    // CRITICAL: Validate note belongs to current workspace
    if (note.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Note workspace mismatch in updateNoteContent!', undefined, {
        noteWorkspace: note.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId,
      });
      return;
    }

    // Mark as user typing
    this.#isUserTyping = true;
    this.#lastUserInputTime = Date.now();

    // Clear typing flag after delay
    setTimeout(() => {
      if (Date.now() - this.#lastUserInputTime >= 1500) {
        this.#isUserTyping = false;
      }
    }, 1500);

    // Update local state immediately for responsiveness
    this.applyNoteUpdate(noteId, { content }, 'user');

    // Debounce save to server
    this.debounceSave(noteId, { content }, immediate);
  }

  /**
   * Update note title (from user input)
   */
  updateNoteTitle(noteId: NoteId, title: string) {
    const note = this.#notes.get(noteId);
    if (!note) return;

    // CRITICAL: Validate note belongs to current workspace
    if (note.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Note workspace mismatch in updateNoteTitle!', undefined, {
        noteWorkspace: note.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId,
      });
      return;
    }

    // Update local state immediately
    this.applyNoteUpdate(noteId, { title }, 'user');

    // Debounce save to server
    this.debounceSave(noteId, { title }, false);
  }

  /**
   * Debounced save to server
   */
  private debounceSave(noteId: NoteId, updates: Partial<Note>, immediate = false) {
    const note = this.#notes.get(noteId);
    if (!note) {
      logger.warn('Note not found for save', { noteId });
      return;
    }

    // Get existing pending updates or start fresh
    const existingOp = this.#saveOperations.get(noteId);
    const pendingUpdates = existingOp ? { ...existingOp.pendingUpdates, ...updates } : updates;

    // Cancel existing save operation for this note
    if (existingOp) {
      clearTimeout(existingOp.timeoutId);
    }

    // Capture current workspace ID at the time of scheduling
    const capturedWorkspaceId = this.#workspaceId;

    if (immediate) {
      // Save immediately with all pending updates
      this.saveToServer(noteId, pendingUpdates, capturedWorkspaceId || undefined);
      this.#saveOperations.delete(noteId);
    } else {
      // Schedule debounced save
      const timeoutId = setTimeout(() => {
        // Validate workspace hasn't changed before saving
        if (this.#workspaceId === capturedWorkspaceId) {
          const op = this.#saveOperations.get(noteId);
          if (op) {
            this.saveToServer(noteId, op.pendingUpdates, capturedWorkspaceId || undefined);
          }
        } else {
          logger.warn('Workspace changed, discarding save for note', {
            noteId,
            originalWorkspace: capturedWorkspaceId,
            currentWorkspace: this.#workspaceId,
          });
        }
        this.#saveOperations.delete(noteId);
      }, this.#saveDebounceMs);

      this.#saveOperations.set(noteId, {
        noteId,
        timeoutId,
        pendingUpdates,
        originalNote: note,
      });
    }
  }

  /**
   * Save note to server
   */
  private async saveToServer(
    noteId: NoteId,
    updates: Partial<Note>,
    expectedWorkspaceId?: WorkspaceId,
  ) {
    // CRITICAL: Double-check workspace hasn't changed
    if (expectedWorkspaceId && expectedWorkspaceId !== this.#workspaceId) {
      // This is expected when switching workspaces quickly, log as debug not error
      logger.debug('Workspace changed during save, cancelling save', {
        expectedWorkspace: expectedWorkspaceId,
        currentWorkspace: this.#workspaceId,
        noteId,
      });
      return;
    }

    // Get the current note to ensure we have all fields
    const currentNote = this.#notes.get(noteId);
    if (!currentNote) {
      // This can happen when switching workspaces, log as debug not warn
      logger.debug('Cannot save note: not found in current workspace', {
        noteId,
        workspace: this.#workspaceId,
      });
      return;
    }

    // CRITICAL: Validate note belongs to current workspace
    if (currentNote.workspaceId !== this.#workspaceId) {
      // This shouldn't happen but log as warning instead of error
      logger.warn('Cannot save note from different workspace', {
        noteWorkspace: currentNote.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId,
      });
      return;
    }

    // Merge updates with current note to ensure we never send partial data
    // Only include fields that are part of UpdateNoteRequest
    const completeUpdate: UpdateNoteRequest & { workspaceId: WorkspaceId } = {
      id: noteId,
      workspaceId: this.#workspaceId!,
      title: updates.title !== undefined ? updates.title : currentNote.title,
      content: updates.content !== undefined ? updates.content : currentNote.content,
      tags: updates.tags !== undefined ? updates.tags : currentNote.tags,
      contentType:
        updates.contentType !== undefined ? updates.contentType : currentNote.contentType,
      isPinned: updates.isPinned !== undefined ? updates.isPinned : currentNote.isPinned,
      isArchived: updates.isArchived !== undefined ? updates.isArchived : currentNote.isArchived,
      visibility: updates.visibility !== undefined ? updates.visibility : currentNote.visibility,
      isUserAction: true, // Mark this as a user action since it's coming from the store's save method
    };

    // Check if content actually changed to avoid unnecessary saves
    const serializedUpdate = JSON.stringify(completeUpdate);
    const lastSaved = this.#lastSavedState.get(noteId);
    if (lastSaved === serializedUpdate) {
      return;
    }

    if (!this.#workspaceId) {
      return;
    }

    try {
      const result = await notesClient.update(completeUpdate);

      if (result.ok && result.data) {
        // Update the local state with the server response
        // This ensures we have the latest updatedAt timestamp and any other server-side changes
        this.#updateNotesMap((map) => map.set(noteId, result.data));

        // Update last saved state
        this.#lastSavedState.set(noteId, serializedUpdate);

        // Mark the note as read since the user just edited it
        // This prevents the note from appearing as "unread" after user saves
        if (this.#workspaceId) {
          noteReadTrackingStore.markNoteRead(this.#workspaceId, noteId);
        }

        logger.debug('Note saved successfully, updated local state');
      } else {
        // Only log as error if it's not a workspace mismatch issue
        const errorMessage = !result.ok ? result.error : 'Unknown error';
        if (errorMessage.includes('workspace') || errorMessage.includes('not found')) {
          logger.debug('Note save failed due to workspace change', { error: errorMessage });
        } else {
          logger.error('Failed to save note', undefined, { error: errorMessage });
          this.#error = errorMessage;
        }

        // Reload the note from server to ensure consistency
        await this.reloadNote(noteId);
      }
    } catch (err) {
      // Handle errors more gracefully
      const errorMessage = err instanceof Error ? err.message : 'Failed to save note';
      if (errorMessage.includes('workspace') || errorMessage.includes('not found')) {
        logger.debug('Note save error due to workspace change', { error: errorMessage });
      } else {
        logger.error('Error saving note', err as Error);
        this.#error = errorMessage;
      }
    }
  }

  /**
   * Reload a specific note from server
   */
  private async reloadNote(_noteId: NoteId) {
    if (!this.#workspaceId) return;

    try {
      // For now, reload all notes since we don't have a single note fetch
      // In production, you'd want a specific endpoint for fetching one note
      await this.reloadNotes();
    } catch (err) {
      logger.error('Failed to reload note', err as Error);
    }
  }

  /**
   * Set editor focus state
   */
  setEditorFocus(hasFocus: boolean) {
    this.#editorHasFocus = hasFocus;
  }

  /**
   * Clear the newly created note ID (called after focusing)
   */
  clearNewlyCreatedNoteId() {
    this.#newlyCreatedNoteId = null;
  }

  /**
   * Notify about content updates (for editor synchronization)
   * The source parameter indicates whether this is from 'agent' (should be trusted)
   * or 'external' (might be rejected if user has unsaved edits)
   */
  private contentUpdateCallbacks = new Set<
    (noteId: NoteId, content: string, source: 'agent' | 'external') => void
  >();

  onContentUpdate(
    callback: (noteId: NoteId, content: string, source: 'agent' | 'external') => void,
  ) {
    this.contentUpdateCallbacks.add(callback);
    return () => this.contentUpdateCallbacks.delete(callback);
  }

  private notifyContentUpdate(
    noteId: NoteId,
    content: string | undefined,
    source: 'agent' | 'external',
  ) {
    // Ensure content is never undefined when notifying
    const safeContent = content || '';
    logger.debug('[NotesStore] notifyContentUpdate', {
      noteId,
      contentLength: safeContent.length,
      source,
    });
    this.contentUpdateCallbacks.forEach((cb) => cb(noteId, safeContent, source));
  }

  /**
   * Flush all pending saves
   */
  async flushPendingSaves() {
    logger.debug('Flushing pending saves');
    const promises: Promise<void>[] = [];

    this.#saveOperations.forEach((op, noteId) => {
      clearTimeout(op.timeoutId);
      promises.push(this.saveToServer(noteId, op.pendingUpdates));
    });

    this.#saveOperations.clear();

    if (promises.length > 0) {
      await Promise.all(promises);
      logger.debug('All pending saves completed');
    }
  }

  /**
   * Clean up
   */
  async cleanup(clearWorkspaceId = true) {
    logger.debug('cleanup() called', { clearWorkspaceId, workspaceId: this.#workspaceId });

    // If workspace is changing, cancel pending saves instead of flushing
    // to prevent cross-workspace contamination
    if (clearWorkspaceId) {
      this.cancelPendingSaves();
    } else {
      // Only flush if staying in same workspace
      await this.flushPendingSaves();
    }

    // Remove event listeners
    this.cleanupEventListeners();

    // Clear callbacks
    this.contentUpdateCallbacks.clear();

    // Clear last saved state
    this.#lastSavedState.clear();

    // Clear all save operations
    this.#saveOperations.forEach((op) => clearTimeout(op.timeoutId));
    this.#saveOperations.clear();

    // Clear state - create new Map to trigger reactivity
    this.#notes = new Map();
    this.#selectedNoteId = null;
    this.#newlyCreatedNoteId = null;
    if (clearWorkspaceId) {
      this.#workspaceId = null;
    }
    this.#isUserTyping = false;
    this.#editorHasFocus = false;
    this.#loading = false;
    this.#error = null;
  }

  /**
   * Cancel all pending saves without executing them
   */
  private cancelPendingSaves() {
    this.#saveOperations.forEach((op) => {
      clearTimeout(op.timeoutId);
    });
    this.#saveOperations.clear();
  }

  // ========== Utility methods ==========

  /**
   * Add an optimistic note to the store.
   * This is used for immediate UI feedback before server response.
   * The note will be replaced with the real one when the server responds.
   */
  addOptimisticNote(note: Note): void {
    logger.debug('Adding optimistic note', { noteId: note.id, title: note.title });
    this.#updateNotesMap((map) => map.set(note.id as NoteId, note));
    this.#newlyCreatedNoteId = note.id as NoteId;
  }

  /**
   * Remove an optimistic note (e.g., on error/rollback)
   */
  removeOptimisticNote(noteId: NoteId): void {
    logger.debug('Removing optimistic note', { noteId });
    this.#updateNotesMap((map) => map.delete(noteId));
    if (this.#newlyCreatedNoteId === noteId) {
      this.#newlyCreatedNoteId = null;
    }
  }

  /**
   * Find a note by ID
   */
  findById(id: NoteId): Note | undefined {
    return this.#notes.get(id);
  }

  /**
   * Find a note by title
   */
  findByTitle(title: string): Note | undefined {
    return Array.from(this.#notes.values()).find((n) => n.title === title);
  }

  /**
   * Search notes by query
   */
  search(query: string): Note[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.#notes.values()).filter(
      (note) =>
        note.title.toLowerCase().includes(lowerQuery) ||
        note.content.toLowerCase().includes(lowerQuery) ||
        note.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );
  }

  /**
   * Reset the store
   */
  reset(): void {
    this.#notes = new Map();
    this.#selectedNoteId = null;
    this.#loading = false;
    this.#error = null;
    this.#workspaceId = null;
  }

  // ========== CRUD Operations ==========

  /**
   * Create a new note
   */
  async create(data: Omit<CreateNoteRequest, 'workspaceId'>): Promise<Result<Note, string>> {
    if (!this.#workspaceId) {
      return { ok: false, error: 'No workspace selected' };
    }

    // Flush any pending saves before creating a new note
    await this.flushPendingSaves();

    this.#loading = true;
    this.#error = null;

    try {
      // Ensure we're creating with clean data
      const cleanData = {
        title: data.title || 'New Note',
        content: data.content || '',
        tags: data.tags || [],
        contentType: data.contentType,
        visibility: data.visibility,
        parentId: data.parentId,
      };

      const result = await notesClient.create({
        ...cleanData,
        workspaceId: this.#workspaceId,
      });

      if (result.ok) {
        // Add to notes map
        this.#updateNotesMap((map) => map.set(result.data.id, result.data));

        // Mark this as a newly created note
        this.#newlyCreatedNoteId = result.data.id;

        // Mark the note as read since the user just created it
        // This prevents the note from appearing as "unread" immediately after creation
        if (this.#workspaceId) {
          noteReadTrackingStore.markNoteRead(this.#workspaceId, result.data.id);
        }

        // Select the new note
        await this.selectNote(result.data.id);

        logger.debug('Created new note', {
          noteId: result.data.id,
          contentLength: result.data.content?.length || 0,
        });
      }
      if (!result.ok) {
        this.#error = result.error;
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to create note';
      this.#error = error;
      return { ok: false, error };
    } finally {
      this.#loading = false;
    }
  }

  /**
   * Update a note
   */
  async update(id: NoteId, updates: Omit<UpdateNoteRequest, 'id'>): Promise<Result<Note, string>> {
    // CRITICAL: Validate note exists in current workspace
    const note = this.#notes.get(id);
    if (!note) {
      logger.error('Cannot update note: not found in current workspace', undefined, {
        noteId: id,
        workspace: this.#workspaceId,
      });
      return { ok: false, error: 'Note not found in current workspace' };
    }

    if (note.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Cannot update note from different workspace!', undefined, {
        noteWorkspace: note.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId: id,
      });
      return { ok: false, error: 'Note belongs to different workspace' };
    }

    try {
      const result = await notesClient.update({
        id,
        workspaceId: this.#workspaceId!,
        ...updates,
      });

      if (result.ok) {
        // CRITICAL: Validate returned note belongs to current workspace
        if (result.data.workspaceId !== this.#workspaceId) {
          logger.error('CRITICAL: Server returned note from different workspace!', undefined, {
            noteWorkspace: result.data.workspaceId,
            currentWorkspace: this.#workspaceId,
            noteId: id,
          });
          return { ok: false, error: 'Workspace mismatch in server response' };
        }

        this.#updateNotesMap((map) => map.set(id, result.data));

        // Update current if it's the same note
        if (this.#selectedNoteId === id) {
          // Trigger reactivity
          this.#selectedNoteId = id;
        }
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to update note';
      return { ok: false, error };
    }
  }

  /**
   * Delete a note
   */
  async delete(id: NoteId): Promise<Result<void, string>> {
    // CRITICAL: Validate note exists in current workspace
    const note = this.#notes.get(id);
    if (!note) {
      logger.error('Cannot delete note: not found in current workspace', undefined, {
        noteId: id,
        workspace: this.#workspaceId,
      });
      return { ok: false, error: 'Note not found in current workspace' };
    }

    if (note.workspaceId !== this.#workspaceId) {
      logger.error('CRITICAL: Cannot delete note from different workspace!', undefined, {
        noteWorkspace: note.workspaceId,
        currentWorkspace: this.#workspaceId,
        noteId: id,
      });
      return { ok: false, error: 'Note belongs to different workspace' };
    }

    try {
      const result = await notesClient.delete(id, this.#workspaceId || undefined);
      if (result.ok) {
        this.#updateNotesMap((map) => map.delete(id));

        // Clear selection if it was deleted
        if (this.#selectedNoteId === id) {
          this.#selectedNoteId = null;
        }
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to delete note';
      return { ok: false, error };
    }
  }

  /**
   * Pin a note
   */
  async pin(id: NoteId): Promise<Result<Note, string>> {
    return this.update(id, { isPinned: true });
  }

  /**
   * Unpin a note
   */
  async unpin(id: NoteId): Promise<Result<Note, string>> {
    return this.update(id, { isPinned: false });
  }

  /**
   * Archive a note
   */
  async archive(id: NoteId): Promise<Result<Note, string>> {
    return this.update(id, { isArchived: true });
  }

  /**
   * Unarchive a note
   */
  async unarchive(id: NoteId): Promise<Result<Note, string>> {
    return this.update(id, { isArchived: false });
  }

  /**
   * Get all notes in current workspace
   */
  get items() {
    return Array.from(this.#notes.values());
  }

  /**
   * Extract primitives from note content
   * @param noteId - The note ID to extract primitives from
   * @returns Array of primitives found in the note
   */
  extractPrimitives(noteId: NoteId): NotePrimitive[] {
    const note = this.#notes.get(noteId);
    if (!note) {
      return [];
    }

    try {
      const parsed = this.#primitivesSerializer.parseMarkdown(note.content);
      // Extract just the primitives from the ParsedPrimitive array
      return parsed.map((p) => p.primitive);
    } catch (error) {
      logger.error('Failed to extract primitives from note', error, { noteId });
      return [];
    }
  }

  /**
   * Update a primitive in a note
   * @param noteId - The note ID containing the primitive
   * @param primitiveId - The ID of the primitive to update
   * @param updates - The updates to apply to the primitive
   */
  async updatePrimitive(
    noteId: NoteId,
    primitiveId: string,
    updates: Partial<NotePrimitive>,
  ): Promise<Result<void, string>> {
    const note = this.#notes.get(noteId);
    if (!note) {
      return { ok: false, error: 'Note not found' };
    }

    try {
      // Parse existing primitives
      const parsed = this.#primitivesSerializer.parseMarkdown(note.content);
      const primitives = parsed.map((p) => p.primitive);

      // Find and update the primitive
      const primitiveIndex = primitives.findIndex((p) => p.id === primitiveId);
      if (primitiveIndex === -1) {
        return { ok: false, error: 'Primitive not found' };
      }

      // Apply updates - use type assertion since we're updating the same type
      const existingPrimitive = primitives[primitiveIndex];
      primitives[primitiveIndex] = {
        ...existingPrimitive,
        ...updates,
        id: primitiveId, // Ensure ID doesn't change
        type: existingPrimitive.type, // Preserve the discriminator
      } as NotePrimitive;

      // Serialize back to markdown
      const updatedContent = this.#primitivesSerializer.serializeToMarkdown(
        primitives,
        note.content,
      );

      // Update the note content
      await this.updateNoteContent(noteId, updatedContent, true);

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to update primitive', error, { noteId, primitiveId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update primitive',
      };
    }
  }

  /**
   * Add a primitive to a note
   * @param noteId - The note ID to add the primitive to
   * @param primitive - The primitive to add
   * @param position - Optional position to insert at (default: end)
   */
  async addPrimitive(
    noteId: NoteId,
    primitive: NotePrimitive,
    position?: number,
  ): Promise<Result<void, string>> {
    const note = this.#notes.get(noteId);
    if (!note) {
      return { ok: false, error: 'Note not found' };
    }

    try {
      // Parse existing primitives
      const parsed = this.#primitivesSerializer.parseMarkdown(note.content);
      const primitives = parsed.map((p) => p.primitive);

      // Add the new primitive
      if (position !== undefined && position >= 0 && position <= primitives.length) {
        primitives.splice(position, 0, primitive);
      } else {
        primitives.push(primitive);
      }

      // Serialize back to markdown
      const updatedContent = this.#primitivesSerializer.serializeToMarkdown(
        primitives,
        note.content,
      );

      // Update the note content
      await this.updateNoteContent(noteId, updatedContent, true);

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to add primitive', error, { noteId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to add primitive',
      };
    }
  }

  /**
   * Remove a primitive from a note
   * @param noteId - The note ID containing the primitive
   * @param primitiveId - The ID of the primitive to remove
   */
  async removePrimitive(noteId: NoteId, primitiveId: string): Promise<Result<void, string>> {
    const note = this.#notes.get(noteId);
    if (!note) {
      return { ok: false, error: 'Note not found' };
    }

    try {
      // Parse existing primitives
      const parsed = this.#primitivesSerializer.parseMarkdown(note.content);
      const primitives = parsed.map((p) => p.primitive);

      // Remove the primitive
      const filteredPrimitives = primitives.filter((p) => p.id !== primitiveId);

      if (filteredPrimitives.length === primitives.length) {
        return { ok: false, error: 'Primitive not found' };
      }

      // Serialize back to markdown
      const updatedContent = this.#primitivesSerializer.serializeToMarkdown(
        filteredPrimitives,
        note.content,
      );

      // Update the note content
      await this.updateNoteContent(noteId, updatedContent, true);

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to remove primitive', error, { noteId, primitiveId });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to remove primitive',
      };
    }
  }
}

// Export singleton instance
export const notesStateManager = new NotesStore();

// Also export as notesStore for clean architecture naming
export const notesStore = notesStateManager;

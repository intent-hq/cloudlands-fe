/**
 * Workspace Content Event Handlers
 *
 * Manages real-time event listeners for the workspace content panel
 */

import { createLogger } from '$lib/utils/client-logger';
import { emit, listenSync } from '$lib/electron-bridge';
import { pathsMatch } from '$lib/utils/file-utils';
import type { DynamicElectronEventName } from '$shared/ipc-registry';
import type { Workspace } from '$shared/types';

const logger = createLogger('WorkspaceContentEventHandlers');

export type EventCallback = (data: any) => void;

export interface EventHandlerCallbacks {
  onFileContentChanged?: (filePath: string, content: string) => void;
  onFileDeleted?: (filePath: string) => void;
  onNoteContentChanged?: (noteId: string, content: string) => void;
  onNoteDeleted?: (noteId: string) => void;
  onDirectoryCreated?: (path: string) => void;
}

export class WorkspaceContentEventHandlers {
  private workspace: Workspace | null = null;
  private unsubscribers: Map<string, () => void> = new Map();
  private callbacks: EventHandlerCallbacks = {};

  constructor() {}

  setWorkspace(workspace: Workspace) {
    this.workspace = workspace;
  }

  setCallbacks(callbacks: EventHandlerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Initialize all event listeners
   */
  initialize(selectedFile?: string, selectedNoteId?: string | null) {
    this.cleanup(); // Clean up any existing listeners first

    if (!this.workspace) return;

    const workspaceId = this.workspace.id;

    // File content change listener
    if (selectedFile) {
      const fileContentHandler = (data: any) => {
        // Check if paths match (handle both absolute and relative paths)
        const eventPath = data.path || '';
        const eventRelativePath = data.relativePath || '';
        const isMatch =
          pathsMatch(eventPath, selectedFile) ||
          pathsMatch(eventRelativePath, selectedFile);

        if (isMatch) {
          // PERF: Changed from INFO to DEBUG - called for every file change
          logger.debug('[EventHandlers] File content changed:', {
            file: selectedFile,
            eventPath,
            eventRelativePath,
            source: data.source,
          });
          this.callbacks.onFileContentChanged?.(selectedFile, data.content || '');
        }
      };

      const eventName: DynamicElectronEventName = `file:content-changed:${workspaceId}`;
      this.unsubscribers.set(
        eventName,
        listenSync(eventName, ({ payload }) => {
          fileContentHandler(payload);
        }),
      );
    }

    // File deletion listener
    if (selectedFile) {
      const fileDeleteHandler = (data: any) => {
        if (data.path === selectedFile) {
          // PERF: Changed from INFO to DEBUG - called for every file deletion
          logger.debug('[EventHandlers] File deleted:', {
            file: selectedFile,
            source: data.source,
          });
          this.callbacks.onFileDeleted?.(selectedFile);
        }
      };

      const eventName: DynamicElectronEventName = `file:deleted:${workspaceId}`;
      this.unsubscribers.set(
        eventName,
        listenSync(eventName, ({ payload }) => {
          fileDeleteHandler(payload);
        }),
      );
    }

    // Note content change listener
    if (selectedNoteId) {
      const noteContentHandler = async (data: any) => {
        if (data.noteId === selectedNoteId) {
          // PERF: Changed from INFO to DEBUG - called for every note change
          logger.debug('[EventHandlers] Note content changed:', {
            noteId: selectedNoteId,
            source: data.source,
            hasContent: !!data.content,
          });

          // Prevent empty spec updates
          if (data.noteId === 'spec' && String(data.content).trim().length === 0) {
            logger.warn('[EventHandlers] Blocked empty spec update', {
              noteId: data.noteId,
              contentLength: data.content?.length,
            });
            return;
          }

          // Emit note:updated event for the NotesStore to handle
          if (data.content !== undefined) {
            await emit('note:updated', {
              noteId: data.noteId,
              workspaceId,
              content: data.content,
              // Preserve the original source (agent, file-system, user, etc.) so downstream
              // safeguards in notes.store can apply the right trust rules and avoid
              // falsely flagging legitimate updates as cross-workspace contamination.
              source: data.source ?? 'external',
            });

            // PERF: Changed from INFO to DEBUG - called for every note update
            logger.debug('[EventHandlers] Emitted note:updated event', {
              noteId: data.noteId,
              contentLength: data.content.length,
            });

            this.callbacks.onNoteContentChanged?.(selectedNoteId, data.content);
          }
        }
      };

      const eventName: DynamicElectronEventName = `note:content-changed:${workspaceId}`;
      this.unsubscribers.set(
        eventName,
        listenSync(eventName, ({ payload }) => {
          void noteContentHandler(payload);
        }),
      );
    }

    // Note deletion listener
    if (selectedNoteId) {
      const noteDeleteHandler = (data: any) => {
        if (data.noteId === selectedNoteId) {
          // PERF: Changed from INFO to DEBUG - called for every note deletion
          logger.debug('[EventHandlers] Note deleted:', {
            noteId: selectedNoteId,
            source: data.source,
          });
          this.callbacks.onNoteDeleted?.(selectedNoteId);
        }
      };

      const eventName: DynamicElectronEventName = `note:deleted:${workspaceId}`;
      this.unsubscribers.set(
        eventName,
        listenSync(eventName, ({ payload }) => {
          noteDeleteHandler(payload);
        }),
      );
    }

    // Directory creation listener
    const dirCreateHandler = (data: any) => {
      // PERF: Changed from INFO to DEBUG - called for every directory creation
      logger.debug('[EventHandlers] Directory created:', {
        path: data.path,
        source: data.source,
      });
      this.callbacks.onDirectoryCreated?.(data.path);
    };

    const eventName: DynamicElectronEventName = `directory:created:${workspaceId}`;
    this.unsubscribers.set(
      eventName,
      listenSync(eventName, ({ payload }) => {
        dirCreateHandler(payload);
      }),
    );
  }

  /**
   * Clean up all event listeners
   */
  cleanup() {
    // Call all registered unsubscribe functions (context isolation safe)
    this.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    });

    this.unsubscribers.clear();
  }
}

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { MetadataSyncService } from '../../../metadata-fs/main/metadata-sync-service';

type SyncFileChangedPayload = { path: string; action: string };

interface LoggerLike {
  warn(message: string, ...args: any[]): void;
}

interface MetadataSyncUiBridgeOptions {
  syncService: MetadataSyncService;
  workspaceId: string;
  localCachePath: string;
  sendToWorkspaceWindows: (workspaceId: string, channel: string, payload: unknown) => void;
  refreshAgents: () => void;
  logger: LoggerLike;
  readFile?: (filePath: string) => Promise<string>;
}

export interface MetadataSyncUiBridge {
  dispose(): void;
}

export function createMetadataSyncUiBridge({
  syncService,
  workspaceId,
  localCachePath,
  sendToWorkspaceWindows,
  refreshAgents,
  logger,
  readFile = (filePath) => fs.readFile(filePath, 'utf-8'),
}: MetadataSyncUiBridgeOptions): MetadataSyncUiBridge {
  const syncContentHashes = new Map<string, string>();
  const pendingNoteRefreshes = new Set<string>();
  const pendingNoteDeletes = new Set<string>();
  let pendingAgentRefresh = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncCompleteTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearPendingState = () => {
    syncContentHashes.clear();
    pendingNoteRefreshes.clear();
    pendingNoteDeletes.clear();
    pendingAgentRefresh = false;
  };

  const flushPendingSyncEvents = async () => {
    if (disposed) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const notesToRefresh = [...pendingNoteRefreshes];
    const notesToDelete = [...pendingNoteDeletes];
    const shouldRefreshAgents = pendingAgentRefresh;
    pendingNoteRefreshes.clear();
    pendingNoteDeletes.clear();
    pendingAgentRefresh = false;

    for (const noteId of notesToDelete) {
      if (disposed) return;
      syncContentHashes.delete(noteId);
      sendToWorkspaceWindows(workspaceId, 'note:deleted', {
        workspaceId,
        noteId,
        source: 'external',
      });
      sendToWorkspaceWindows(workspaceId, `note:deleted:${workspaceId}`, {
        noteId,
        source: 'external',
        workspaceId,
      });
    }

    for (const noteId of notesToRefresh) {
      try {
        const notePath = path.join(localCachePath, 'notes', `${noteId}.md`);
        const content = await readFile(notePath);
        if (disposed) return;

        const hash = createHash('sha256').update(content).digest('hex');
        if (syncContentHashes.get(noteId) === hash) {
          continue;
        }
        syncContentHashes.set(noteId, hash);

        let markdownContent = content;
        const trimmed = content.trim();
        if (trimmed.startsWith('---')) {
          const endIndex = trimmed.indexOf('---', 3);
          if (endIndex !== -1) {
            markdownContent = trimmed.slice(endIndex + 3).trim();
          }
        }

        sendToWorkspaceWindows(workspaceId, 'note:updated', {
          workspaceId,
          noteId,
          content: markdownContent,
          source: 'external',
        });
        sendToWorkspaceWindows(workspaceId, `note:content-changed:${workspaceId}`, {
          noteId,
          content: markdownContent,
          source: 'external',
          workspaceId,
        });
      } catch (err) {
        logger.warn('[WorkspaceIPC] Failed to read synced note for UI refresh', {
          noteId,
          error: (err as Error).message,
        });
      }
    }

    if (shouldRefreshAgents && !disposed) {
      refreshAgents();
    }
  };

  const scheduleSyncFlush = () => {
    if (disposed) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      flushPendingSyncEvents().catch((err) => {
        logger.warn('[WorkspaceIPC] Error flushing sync events', {
          error: (err as Error).message,
        });
      });
    }, 500);
  };

  const onSyncFileChanged = ({ path: relativePath, action }: SyncFileChangedPayload) => {
    if (disposed) return;
    if (relativePath.startsWith('notes/') && relativePath.endsWith('.md') && !relativePath.includes('.meta/')) {
      const noteId = relativePath.replace('notes/', '').replace('.md', '');
      if (action === 'delete') {
        pendingNoteDeletes.add(noteId);
        pendingNoteRefreshes.delete(noteId);
      } else {
        pendingNoteRefreshes.add(noteId);
        pendingNoteDeletes.delete(noteId);
      }
      scheduleSyncFlush();
      return;
    }

    if (relativePath.startsWith('notes/.meta/') && relativePath.endsWith('.json')) {
      const fileName = path.basename(relativePath);
      const dotIndex = fileName.indexOf('.');
      if (dotIndex > 0) {
        pendingNoteRefreshes.add(fileName.substring(0, dotIndex));
        scheduleSyncFlush();
      }
      return;
    }

    if (relativePath.startsWith('agents/') && relativePath.endsWith('.json')) {
      pendingAgentRefresh = true;
      scheduleSyncFlush();
    }
  };

  const onSyncComplete = () => {
    if (disposed) return;
    if (syncCompleteTimer) {
      clearTimeout(syncCompleteTimer);
    }
    syncCompleteTimer = setTimeout(() => {
      syncCompleteTimer = null;
      flushPendingSyncEvents().catch((err) => {
        logger.warn('[WorkspaceIPC] Error flushing sync events after full sync', {
          error: (err as Error).message,
        });
      });
    }, 200);
  };

  syncService.on('sync:file-changed', onSyncFileChanged);
  syncService.on('sync:complete', onSyncComplete);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (syncCompleteTimer) {
        clearTimeout(syncCompleteTimer);
        syncCompleteTimer = null;
      }
      syncService.off('sync:file-changed', onSyncFileChanged);
      syncService.off('sync:complete', onSyncComplete);
      clearPendingState();
    },
  };
}
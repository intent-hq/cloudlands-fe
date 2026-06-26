/**
 * Files write service — the sanctioned post-saga file-mutation mechanism.
 *
 * Components call these functions from event handlers instead of dispatching the
 * (now dead) saga-trigger actions. Each operation: (1) applies an optional
 * optimistic store update for instant UI feedback, (2) awaits the matching
 * `appClient.files.*` mutation (which forwards to intentd and never throws — it
 * returns a `MutationResult`), and (3) reconciles: on success the live `file:*`
 * subscribe→refetch loop converges the store; on failure the optimistic change
 * is rolled back (or the entry is refetched from disk).
 *
 * Content saves are debounced HERE (keyed by `workspaceId::path`) so the
 * mechanism — not the component — owns the timing the removed saga used to
 * provide. Pass `{ immediate: true }` (or call `flushFileContent`) to bypass the
 * debounce on teardown so no edit is lost.
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, slice actions, and selectors (per src/store AGENTS.md).
 */
import { appClient } from "$lib/client";
import type { MutationResult } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  applyExternalFileContent,
  removeFileContentEntry,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from "$store/renderer/slices/files/files-slice";
import { selectFileContentEntry } from "$store/renderer/slices/files/files-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("FilesWriteService");

/** Debounce window for content saves (the removed component debounce was ~1.5s). */
export const FILE_CONTENT_SAVE_DEBOUNCE_MS = 1500;

interface PendingContent {
  workspaceId: string;
  path: string;
  absolutePath: string;
  content: string;
}

const contentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingContent = new Map<string, PendingContent>();

function contentKey(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

/**
 * Apply a content edit optimistically and queue a debounced `file.write`. The
 * network save coalesces rapid edits per file; pass `{ immediate: true }` to
 * flush right away (e.g. on Cmd+S or editor teardown).
 */
export function writeFileContent(
  workspaceId: string,
  path: string,
  absolutePath: string,
  content: string,
  options?: { immediate?: boolean },
): void {
  appStore.dispatch(updateFileContent(workspaceId, path, content));

  const key = contentKey(workspaceId, path);
  pendingContent.set(key, { workspaceId, path, absolutePath, content });

  const existing = contentTimers.get(key);
  if (existing) clearTimeout(existing);

  if (options?.immediate) {
    contentTimers.delete(key);
    void flushContent(key);
    return;
  }
  contentTimers.set(
    key,
    setTimeout(() => {
      contentTimers.delete(key);
      void flushContent(key);
    }, FILE_CONTENT_SAVE_DEBOUNCE_MS),
  );
}

async function flushContent(key: string): Promise<void> {
  const pending = pendingContent.get(key);
  if (!pending) return;
  pendingContent.delete(key);
  const timer = contentTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    contentTimers.delete(key);
  }

  const { workspaceId, path, absolutePath, content } = pending;
  appStore.dispatch(saveFileContentRequested(workspaceId, path, absolutePath, content));

  const result = await appClient.files.write(workspaceId, path, content);
  if (result.success) {
    appStore.dispatch(saveFileContentSucceeded(workspaceId, path, content));
  } else {
    logger.error("Failed to save file content", result.error);
    appStore.dispatch(saveFileContentFailed(workspaceId, path, result.error ?? "Failed to save file"));
  }
}

/** Flush a pending debounced content save immediately (e.g. on editor teardown). */
export function flushFileContent(workspaceId: string, path: string): void {
  const key = contentKey(workspaceId, path);
  if (pendingContent.has(key)) void flushContent(key);
}

/** Create (or overwrite) a file with the given content; returns the seam result. */
export async function createFile(
  workspaceId: string,
  path: string,
  content = "",
): Promise<MutationResult> {
  const result = await appClient.files.write(workspaceId, path, content);
  if (!result.success) logger.error("Failed to create file", result.error);
  return result;
}

/** Delete a file optimistically (drop the cached entry); refetch it on failure. */
export async function deleteFile(workspaceId: string, path: string): Promise<MutationResult> {
  const snapshot = selectFileContentEntry.select(appStore.state, workspaceId, path);
  appStore.dispatch(removeFileContentEntry(workspaceId, path));

  const result = await appClient.files.delete(workspaceId, path);
  if (!result.success) {
    logger.error("Failed to delete file", result.error);
    if (snapshot) {
      const entry = await appClient.files.read(workspaceId, path);
      const restored = entry?.localContent ?? snapshot.originalContent ?? "";
      appStore.dispatch(applyExternalFileContent(workspaceId, path, restored));
    }
  }
  return result;
}

/** Create a directory; returns the seam result. */
export async function createDirectory(workspaceId: string, path: string): Promise<MutationResult> {
  const result = await appClient.files.mkdir(workspaceId, path);
  if (!result.success) logger.error("Failed to create directory", result.error);
  return result;
}

/** Rename/move a file; drops the stale cached entry on success. */
export async function renameFile(
  workspaceId: string,
  oldPath: string,
  newPath: string,
): Promise<MutationResult> {
  const result = await appClient.files.rename(workspaceId, oldPath, newPath);
  if (result.success) {
    appStore.dispatch(removeFileContentEntry(workspaceId, oldPath));
  } else {
    logger.error("Failed to rename file", result.error);
  }
  return result;
}

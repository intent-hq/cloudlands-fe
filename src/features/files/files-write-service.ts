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
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/empty-state, pure path utils, and the
 * logger (NOT selectors — once registered in `middleware.ts`, statically
 * importing a `*-selectors.ts` module would evaluate `store.createSelector`
 * while the store module is still mid-initialization through the middleware
 * chain). State reads use the raw `appStore.state` shape instead.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import { appClient } from "$lib/client";
import type { MutationResult } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  applyExternalFileContent,
  emptyFilesWorkspaceState,
  removeFileContentEntry,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from "$store/renderer/slices/files/files-slice";
import {
  emptyFileExplorerWorkspaceState,
  refreshDirectoryRequested,
} from "$store/renderer/slices/file-explorer/file-explorer-slice";
import { createFileRequested } from "$store/renderer/slices/app-layout/app-layout-slice";
import { openWorkspaceFile } from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
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

/** Direct (selector-free) read of the cached file entry; see header note. */
function readFileEntry(workspaceId: string, path: string) {
  const ws = appStore.state.files.byWorkspaceId[workspaceId] ?? emptyFilesWorkspaceState;
  return getItem(ws.files, path);
}

/** Delete a file optimistically (drop the cached entry); refetch it on failure. */
export async function deleteFile(workspaceId: string, path: string): Promise<MutationResult> {
  const snapshot = readFileEntry(workspaceId, path);
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

/**
 * Handle the (post-saga) `createFileRequested` action. The action carries the
 * absolute `folderPath` (under the workspace root) and the bare `fileName`; the
 * daemon's `file.write` expects a workspace-relative path, so we strip the
 * workspace prefix before forwarding. On success we dispatch
 * `refreshDirectoryRequested` so the new file appears in the tree and
 * `openWorkspaceFile` to mirror the original "create then open" behavior.
 */
async function handleCreateFileRequested(
  workspaceId: string,
  folderPath: string,
  fileName: string,
): Promise<void> {
  if (!workspaceId || !folderPath || !fileName) return;
  const absoluteFilePath = `${folderPath}/${fileName}`;

  // Read workspacePath directly from the file-explorer slice (no selector
  // import — see header note about the middleware-chain init cycle).
  const ws =
    appStore.state.fileExplorer.byWorkspaceId[workspaceId] ?? emptyFileExplorerWorkspaceState;
  const workspacePath = ws.workspacePath;
  if (!workspacePath) {
    logger.error("Cannot create file without workspacePath", { workspaceId });
    return;
  }

  const relativePath = stripWorkspacePrefix(absoluteFilePath, workspacePath);
  if (!relativePath || relativePath === absoluteFilePath) {
    logger.error("Refusing to create file outside workspace", { workspaceId, absoluteFilePath });
    return;
  }

  const result = await createFile(workspaceId, relativePath, "");
  if (!result.success) return;

  appStore.dispatch(refreshDirectoryRequested(workspaceId, absoluteFilePath));
  appStore.dispatch(openWorkspaceFile(workspaceId, absoluteFilePath));
}

/**
 * Middleware that gives the (post-saga) `createFileRequested` trigger a real
 * handler: after the (no-op) reducer passes the action through, it forwards to
 * `appClient.files.write` and reconciles the tree + opens the new file.
 * Fire-and-forget — dispatch stays synchronous and never throws.
 */
export function createFilesWriteMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action?.type === createFileRequested.type && Array.isArray(action.payload)) {
      const [wsId, folderPath, fileName] = action.payload as [unknown, unknown, unknown];
      if (
        typeof wsId === "string" &&
        wsId.length > 0 &&
        typeof folderPath === "string" &&
        folderPath.length > 0 &&
        typeof fileName === "string" &&
        fileName.length > 0
      ) {
        void handleCreateFileRequested(wsId, folderPath, fileName);
      }
    }
    return result;
  };
}

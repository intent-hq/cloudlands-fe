/**
 * Files read service — the sanctioned post-saga file-content read mechanism.
 *
 * The `loadFileContentRequested` action lost its handler when the saga runtime
 * was removed: the `files` reducer flips `loading: true` but no consumer ever
 * calls `appClient.files.read`, so `loadFileContentSucceeded`/`Failed` never
 * fire and the FileTabType skeleton hangs forever. This restores the read path
 * WITHOUT re-adding a saga and WITHOUT changing any call site:
 * `createFilesReadMiddleware()` observes every dispatched action and, on
 * `loadFileContentRequested`, runs a (deduped) read via `appClient.files.read`
 * and dispatches the matching success/failure action.
 *
 * READ-ONLY: this module never invokes a file mutation (no write/delete/etc).
 *
 * Reads are coalesced per `${wsId}::${path}` via an in-flight map so the
 * FileTabType `$effect` re-dispatch (which fires on every state change while
 * the entry is loading) collapses into a single `file.read` fetch.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions, and the logger (NOT selectors —
 * importing them would evaluate `store.createSelector` while the store module
 * is still mid-initialization through the middleware chain).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
} from "$store/renderer/slices/files/files-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("FilesReadService");

/** In-flight reads keyed by `${wsId}::${path}`; coalesces concurrent requests. */
const inFlight = new Map<string, Promise<void>>();

function readKey(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

/**
 * Fetch a single file's content from the seam and dispatch the matching
 * success/failure action. Errors are caught and translated to
 * `loadFileContentFailed` so a failed read surfaces the existing "Error loading
 * file" state instead of leaving the skeleton spinning. A `null` return from
 * the seam is treated as failure for the same reason. Concurrent calls for the
 * same `(workspaceId, path)` share one fetch.
 */
export async function ensureFileContent(
  workspaceId: string,
  path: string,
  absolutePath: string,
): Promise<void> {
  const key = readKey(workspaceId, path);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async () => {
    try {
      const entry = await appClient.files.read(workspaceId, path);
      if (entry) {
        const content = entry.originalContent ?? entry.localContent ?? "";
        appStore.dispatch(
          loadFileContentSucceeded(
            workspaceId,
            path,
            absolutePath,
            content,
            entry.isBinary,
            entry.truncated,
          ),
        );
      } else {
        appStore.dispatch(
          loadFileContentFailed(workspaceId, path, absolutePath, "File not found"),
        );
      }
    } catch (error) {
      logger.error("Failed to load file content", error);
      const message = error instanceof Error ? error.message : String(error);
      appStore.dispatch(loadFileContentFailed(workspaceId, path, absolutePath, message));
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, run);
  return run;
}

/**
 * Middleware that gives `loadFileContentRequested` a real handler: after the
 * action passes through the reducer (which flips `loading: true`), it kicks
 * off a (deduped) read for the target file. Fire-and-forget — dispatch stays
 * synchronous and never throws. The action payload is the
 * `[wsId, path, absolutePath, options?]` tuple.
 */
export function createFilesReadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === loadFileContentRequested.type) {
      const payload = Array.isArray(action.payload) ? action.payload : undefined;
      const wsId = payload?.[0];
      const path = payload?.[1];
      const absolutePath = payload?.[2];
      if (
        typeof wsId === "string" &&
        wsId.length > 0 &&
        typeof path === "string" &&
        path.length > 0 &&
        typeof absolutePath === "string"
      ) {
        void ensureFileContent(wsId, path, absolutePath);
      }
    }
    return result;
  };
}

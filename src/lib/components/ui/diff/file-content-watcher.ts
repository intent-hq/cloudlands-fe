/**
 * Shared `file:content-changed:{workspaceId}` subscriber.
 *
 * Wave 3 perf work: every TrackedChangeDiffViewer used to register its own
 * `listenSync` to the workspace-wide `file:content-changed:{wsId}` event.
 * With 100 mounted diffs that means 100 IPC listeners receiving every
 * file-change event and each maintaining its own debounce timer.
 *
 * This module keeps exactly one IPC listener per workspace and fans out to
 * per-path handler sets. Each subscriber still receives debounced callbacks
 * (300ms, matching the previous per-instance behaviour).
 */

import { listenSync } from '$lib/electron-bridge';
import { pathsMatch } from '$lib/utils/file-utils';

type Handler = () => void;

interface WorkspaceEntry {
  /** Releases the IPC listener when the map becomes empty. */
  unsubscribe: () => void;
  /** Map from the registered filePath → set of handlers to invoke. */
  handlersByPath: Map<string, Set<Handler>>;
  /** Per-path debounce timer so multiple rapid events coalesce into one fire. */
  debounceByPath: Map<string, ReturnType<typeof setTimeout>>;
}

const DEBOUNCE_MS = 300;

const workspaces = new Map<string, WorkspaceEntry>();

interface FileChangedPayload {
  path?: string;
  relativePath?: string;
}

function dispatchChange(entry: WorkspaceEntry, changedPath: string) {
  for (const [registeredPath, handlers] of entry.handlersByPath) {
    if (!pathsMatch(changedPath, registeredPath)) continue;

    const existing = entry.debounceByPath.get(registeredPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      entry.debounceByPath.delete(registeredPath);
      for (const handler of handlers) {
        try {
          handler();
        } catch {
          // Swallow per-handler errors — one subscriber shouldn't break others.
        }
      }
    }, DEBOUNCE_MS);
    entry.debounceByPath.set(registeredPath, timer);
  }
}

function ensureEntry(workspaceId: string): WorkspaceEntry {
  const existing = workspaces.get(workspaceId);
  if (existing) return existing;

  const entry: WorkspaceEntry = {
    unsubscribe: () => {},
    handlersByPath: new Map(),
    debounceByPath: new Map(),
  };

  entry.unsubscribe = listenSync<FileChangedPayload>(
    `file:content-changed:${workspaceId}`,
    (event) => {
      const data = event.payload;
      const changedPath = data?.path || data?.relativePath;
      if (!changedPath) return;
      dispatchChange(entry, changedPath);
    },
  );

  workspaces.set(workspaceId, entry);
  return entry;
}

/**
 * Subscribe to `file:content-changed` events for a given workspace + file path.
 * The returned function unsubscribes; the underlying IPC listener is torn down
 * once the last subscriber for a workspace is removed.
 */
export function subscribeFileContentChange(
  workspaceId: string,
  filePath: string,
  handler: Handler,
): () => void {
  const entry = ensureEntry(workspaceId);
  let handlers = entry.handlersByPath.get(filePath);
  if (!handlers) {
    handlers = new Set();
    entry.handlersByPath.set(filePath, handlers);
  }
  handlers.add(handler);

  return () => {
    const current = entry.handlersByPath.get(filePath);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) {
      entry.handlersByPath.delete(filePath);
      const timer = entry.debounceByPath.get(filePath);
      if (timer) {
        clearTimeout(timer);
        entry.debounceByPath.delete(filePath);
      }
    }
    if (entry.handlersByPath.size === 0) {
      entry.unsubscribe();
      for (const t of entry.debounceByPath.values()) clearTimeout(t);
      entry.debounceByPath.clear();
      workspaces.delete(workspaceId);
    }
  };
}

/**
 * Test-only helper — number of active workspace listeners.
 */
export function __activeWorkspaceCount(): number {
  return workspaces.size;
}

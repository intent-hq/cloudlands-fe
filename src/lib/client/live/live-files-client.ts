/**
 * Live files domain backed by the intentd daemon.
 *
 * `read` resolves via `file.read({ workspaceId, path })` and is mapped into the
 * renderer `FileContentEntry` cache shape. `gitStatusMap` is DERIVED from
 * `git.status` (the daemon exposes no per-path status map). `explorerTree`
 * resolves via the additive `file.tree` read (PROTOCOL §5.9), anchored at the
 * workspace root; transport/daemon errors fold to `null` so the explorer
 * degrades cleanly. `list` returns an empty content cache (the daemon's
 * directory listing is not a `FileContentEntry` collection). `subscribe`
 * refetches on `file:*` events.
 */
import type { FileGitStatus, FileNode } from "$shared/types";
import type { FileContentEntry } from "$store/renderer/slices/files/files-types";
import type {
  FilesClient,
  MutationResult,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { isEventInFamily, newIdempotencyKey, runMutation } from "./live-support";

/** Map raw daemon file content into a `FileContentEntry`. */
function toFileContentEntry(path: string, content: string): FileContentEntry {
  return {
    path,
    absolutePath: null,
    originalContent: content,
    localContent: content,
    lastUpdated: Date.now(),
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
  };
}

/**
 * Map a raw daemon `file.list` payload into `FileNode[]`. Tolerant of the shape
 * the directory listing arrives in: a bare array, or wrapped under `entries` /
 * `files`. Children are left unset (lazy) — the explorer fetches deeper levels
 * on demand. Entries missing both a name and a path are skipped.
 */
function toFileNodes(result: unknown): FileNode[] {
  const raw = result as { entries?: unknown[]; files?: unknown[] } | unknown[] | null;
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.entries)
      ? raw.entries
      : Array.isArray(raw?.files)
        ? raw.files
        : [];

  const nodes: FileNode[] = [];
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name : undefined;
    const rawPath = typeof entry.path === "string" ? entry.path : undefined;
    const path = rawPath ?? name;
    if (!path) continue;
    const isDirectory =
      entry.type === "directory" || entry.type === "dir" || entry.isDirectory === true;
    const node: FileNode = {
      name: name ?? path.split("/").pop() ?? path,
      path,
      type: isDirectory ? "directory" : "file",
    };
    if (typeof entry.size === "number") node.size = entry.size;
    if (typeof entry.modified === "string") node.modified = entry.modified;
    if (typeof entry.isGitignored === "boolean") node.isGitignored = entry.isGitignored;
    nodes.push(node);
  }
  return nodes;
}

/** Build a two-char porcelain-style status code from a daemon single-char code. */
function toPorcelain(status: string, staged: boolean): string {
  const code = status.trim();
  if (code === "?") return "??";
  return staged ? `${code} ` : ` ${code}`;
}

export class LiveFilesClient implements FilesClient {
  // The daemon's `file.list` is a directory listing, not the per-file content
  // cache this method models; the content cache is populated on demand via
  // `read`, so the initial list is empty.
  async list(_workspaceId: string): Promise<FileContentEntry[]> {
    return [];
  }

  async read(workspaceId: string, path: string): Promise<FileContentEntry | null> {
    try {
      const result = await backendRequest<unknown>("file.read", { workspaceId, path });
      const content =
        typeof result === "string"
          ? result
          : typeof (result as { content?: unknown })?.content === "string"
            ? (result as { content: string }).content
            : null;
      if (content === null) return null;
      return toFileContentEntry(path, content);
    } catch {
      return null;
    }
  }

  // `file.tree` (PROTOCOL §5.9) returns the immediate entries under the given
  // path as a BARE array; anchor the explorer at the workspace root (`"."`) and
  // wrap the entries as the synthetic root `FileNode`'s children (the wire
  // result is shallow — deeper levels load lazily via `listDirectory`).
  async explorerTree(workspaceId: string): Promise<FileNode | null> {
    try {
      const result = await backendRequest<unknown>("file.tree", { workspaceId, path: "." });
      const children = toFileNodes(result);
      return { name: "", path: "", type: "directory", children };
    } catch {
      return null;
    }
  }

  // Directory listing via the daemon's `file.list` (a directory listing, unlike
  // `list` which models the content cache). Used by the explorer to lazily load
  // a directory's children on expand/refresh. Errors resolve to `[]` so a failed
  // read leaves the existing rows intact rather than throwing into the store.
  async listDirectory(workspaceId: string, path: string): Promise<FileNode[]> {
    try {
      const result = await backendRequest<unknown>("file.list", { workspaceId, path });
      return toFileNodes(result);
    } catch {
      return [];
    }
  }

  async gitStatusMap(workspaceId: string): Promise<Record<string, FileGitStatus>> {
    try {
      const result = await backendRequest<{ files?: unknown[] }>("git.status", { workspaceId });
      const files = Array.isArray(result?.files) ? result.files : [];
      const map: Record<string, FileGitStatus> = {};
      for (const f of files) {
        const file = f as Record<string, unknown>;
        const path = String(file.path ?? "");
        if (!path) continue;
        map[path] = {
          status: toPorcelain(String(file.status ?? ""), Boolean(file.staged)),
        };
      }
      return map;
    } catch {
      return {};
    }
  }

  // ---- Mutations ----------------------------------------------------------
  // Each forwards to the daemon (§7.6) and folds the outcome into a
  // MutationResult; the subscribe→refetch loop reconciles store state from the
  // resulting `file:*` events. All file mutations are workspace-scoped and use
  // workspace-relative paths. `write`/`mkdir`/`rename` are create-ish, so they
  // carry an idempotencyKey (§5.6: required on create, best-effort elsewhere).
  // DATA SAFETY: these are destructive against the user's real files; they are
  // only ever exercised against the FAKE socket in tests.

  async write(workspaceId: string, path: string, content: string): Promise<MutationResult> {
    return runMutation("file.write", {
      workspaceId,
      path,
      content,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  async delete(workspaceId: string, path: string): Promise<MutationResult> {
    return runMutation("file.delete", { workspaceId, path });
  }

  async mkdir(workspaceId: string, path: string): Promise<MutationResult> {
    return runMutation("file.mkdir", { workspaceId, path, idempotencyKey: newIdempotencyKey() });
  }

  async rename(workspaceId: string, oldPath: string, newPath: string): Promise<MutationResult> {
    return runMutation("file.rename", {
      workspaceId,
      oldPath,
      newPath,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  subscribe(handler: SubscriptionHandler<FileContentEntry[]>): Unsubscribe {
    let disposed = false;
    let subscriptionId: string | undefined;

    const emit = () => {
      if (!disposed) handler([]);
    };

    emit();

    const off = onBackendNotification((n) => {
      if (isEventInFamily(n.method, n.params, "file")) emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: ["file:changed", "file:created", "file:deleted", "file:renamed"],
    })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we still serve the initial snapshot.
      });

    return () => {
      disposed = true;
      off();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}

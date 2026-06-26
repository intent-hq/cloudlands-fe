/**
 * Live files domain backed by the intentd daemon.
 *
 * `read` resolves via `file.read({ workspaceId, path })` and is mapped into the
 * renderer `FileContentEntry` cache shape. `gitStatusMap` is DERIVED from
 * `git.status` (the daemon exposes no per-path status map). The daemon has no
 * file-tree endpoint, so `explorerTree` resolves to `null`; `list` returns an
 * empty content cache (the daemon's directory listing is not a `FileContentEntry`
 * collection). `subscribe` refetches on `file:*` events.
 */
import type { FileGitStatus } from "$shared/types";
import type { FileContentEntry } from "$store/renderer/slices/files/files-types";
import type {
  FilesClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { isEventInFamily } from "./live-support";

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

  // The daemon exposes no file-tree endpoint; recursively walking `file.list`
  // would be prohibitively chatty on real repos, so no tree is provided here.
  async explorerTree(): Promise<null> {
    return null;
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

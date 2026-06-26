/**
 * Live git domain backed by the intentd daemon.
 *
 * `status` (and `changes`, which mirrors it) resolve via `git.status`, returning
 * the daemon's working-tree summary directly in the renderer `GitStatus` shape.
 * `prStatus` resolves via `pr.status` (the daemon errors when no PR is active, so
 * that is folded to `null`). The daemon does NOT yet expose diff / commit-history
 * / tracked-change read methods, so those resolve to empty for now (no mock
 * fallback) — mirroring how `LiveWorkspacesClient.recentViews` handles
 * not-yet-exposed surfaces. `subscribe` refetches on `git:*` / `changes:git-status`
 * events.
 */
import { GitFileStatus } from "$shared/types";
import type { DiffChunk, FileStatus, GitStatus } from "$shared/types";
import type { CommitInfo, TrackedChange } from "$features/file-tracking/types";
import type {
  GitClient,
  PrStatusSummary,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { isEventInFamily, listWorkspaceIds } from "./live-support";

/** Coerce a raw daemon git-status object into the renderer `GitStatus` shape. */
function normalizeGitStatus(raw: Record<string, unknown>): GitStatus {
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const files: FileStatus[] = rawFiles.map((f) => {
    const file = f as Record<string, unknown>;
    return {
      path: String(file.path ?? ""),
      status: (typeof file.status === "string"
        ? file.status.trim() || GitFileStatus.Modified
        : GitFileStatus.Modified) as GitFileStatus,
      staged: Boolean(file.staged),
    };
  });
  return {
    branch: String(raw.branch ?? ""),
    ahead: Number(raw.ahead ?? 0),
    behind: Number(raw.behind ?? 0),
    diverged: Boolean(raw.diverged),
    files,
    hasUncommittedChanges: Boolean(raw.hasUncommittedChanges),
    hasUntrackedFiles: Boolean(raw.hasUntrackedFiles),
  };
}

async function fetchStatus(workspaceId: string): Promise<GitStatus | null> {
  try {
    const result = await backendRequest<unknown>("git.status", { workspaceId });
    if (!result || typeof result !== "object") return null;
    return normalizeGitStatus(result as Record<string, unknown>);
  } catch {
    return null;
  }
}

export class LiveGitClient implements GitClient {
  async status(workspaceId: string): Promise<GitStatus | null> {
    return fetchStatus(workspaceId);
  }

  // The daemon has no distinct "changes" read; the working-tree status is the
  // single source of truth, matching the prior mock behavior.
  async changes(workspaceId: string): Promise<GitStatus | null> {
    return fetchStatus(workspaceId);
  }

  // Diff / tracked-change / commit-history reads are not exposed by the daemon
  // yet; resolve empty until those wire methods land.
  async diffs(_workspaceId: string): Promise<DiffChunk[]> {
    return [];
  }
  async trackedChanges(_workspaceId: string): Promise<TrackedChange[]> {
    return [];
  }
  async commits(_workspaceId: string): Promise<CommitInfo[]> {
    return [];
  }

  // `pr.status` returns the active PR summary; it errors when the workspace has
  // no active PR, which is folded to `null` (the seam's "no PR" signal).
  async prStatus(workspaceId: string): Promise<PrStatusSummary | null> {
    try {
      const result = await backendRequest<Record<string, unknown>>("pr.status", { workspaceId });
      if (!result || typeof result !== "object") return null;
      return {
        prNumber: typeof result.prNumber === "number" ? result.prNumber : undefined,
        url: typeof result.url === "string" ? result.url : undefined,
        state: typeof result.state === "string" ? result.state : undefined,
      };
    } catch {
      return null;
    }
  }

  subscribe(handler: SubscriptionHandler<GitStatus | null>): Unsubscribe {
    let disposed = false;
    let subscriptionId: string | undefined;

    const emit = () => {
      listWorkspaceIds()
        .then((ids) => (ids.length > 0 ? fetchStatus(ids[0]) : null))
        .then((status) => {
          if (!disposed) handler(status);
        })
        .catch(() => {
          // Snapshot refresh failures are non-fatal for the subscription.
        });
    };

    emit();

    const off = onBackendNotification((n) => {
      if (isEventInFamily(n.method, n.params, "git") || isEventInFamily(n.method, n.params, "changes"))
        emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({
      eventTypes: ["git:commit", "git:push", "git:pull", "git:branch", "git:merge", "changes:git-status"],
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

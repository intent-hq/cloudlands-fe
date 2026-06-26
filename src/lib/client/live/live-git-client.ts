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
 * events. `stage` and `commit` are the two supported write mutations (`git.stage`
 * / `git.commit`); both fold the daemon outcome into a `MutationResult`.
 */
import { GitFileStatus } from "$shared/types";
import type { DiffChunk, FileStatus, GitStatus } from "$shared/types";
import type { CommitInfo, TrackedChange } from "$features/file-tracking/types";
import type {
  GitClient,
  GitCommitParams,
  MutationResult,
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
import { isEventInFamily, listWorkspaceIds, newIdempotencyKey, runMutation } from "./live-support";

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

  // ---- Mutations ----------------------------------------------------------
  // Each forwards to the daemon (§7) and folds the outcome into a
  // MutationResult; the subscribe→refetch loop (git status channel) reconciles
  // store state from the resulting `git:*` events. Never throws, never fakes
  // success.

  // `git.stage` requires explicit paths: all-files globs ('.'/'*'/'--all') are
  // rejected upstream (mirroring the daemon contract) so the request is never
  // even sent. `git.unstage` is a backend gap and is intentionally NOT wired.
  async stage(workspaceId: string, paths: string[]): Promise<MutationResult> {
    const cleaned = paths.map((path) => path.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      return { success: false, error: "No file paths provided; staging requires explicit paths." };
    }
    if (cleaned.some((path) => path === "." || path === "*" || path.includes("--all"))) {
      return {
        success: false,
        error: "Staging all files is not allowed; specify explicit file paths.",
      };
    }
    return runMutation("git.stage", { workspaceId, paths: cleaned });
  }

  // `git.commit` is DESTRUCTIVE: it requires `userRequested: true` and carries
  // an idempotencyKey (§5.6/§7.7) so retried requests are deduped server-side.
  async commit(workspaceId: string, params: GitCommitParams): Promise<MutationResult> {
    if (!params.userRequested) {
      return { success: false, error: "git.commit requires userRequested: true." };
    }
    return runMutation("git.commit", {
      workspaceId,
      message: params.message,
      ...(params.files !== undefined ? { files: params.files } : {}),
      ...(params.amend !== undefined ? { amend: params.amend } : {}),
      userRequested: params.userRequested,
      idempotencyKey: newIdempotencyKey(),
    });
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

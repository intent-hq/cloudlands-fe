/**
 * Live git domain backed by the intentd daemon.
 *
 * `status` (and `changes`, which mirrors it) resolve via `git.status`, returning
 * the daemon's working-tree summary directly in the renderer `GitStatus` shape.
 * `prStatus` resolves via `pr.status` (the daemon errors when no PR is active, so
 * that is folded to `null`). `diffs` / `commits` / `trackedChanges` resolve via
 * the additive `git.diffs` / `git.commits` / `git.changes` reads (PROTOCOL §5.6)
 * and are mapped into the renderer `DiffChunk[]` / `CommitInfo[]` / `TrackedChange[]`
 * shapes; transport/daemon errors fold to an empty list so a single failed read
 * does not throw into the store. `subscribe` refetches on `git:*` /
 * `changes:git-status` events. `stage` and `commit` are the two supported write
 * mutations: `stage` forwards to `git.stage`; `commit` forwards to
 * `git.agentCommit` (the wire-canonical commit method — `git.commit` is
 * deprecated per §5.6). Both fold the daemon outcome into a `MutationResult`.
 */
import { GitFileStatus, LineType } from "$shared/types";
import type { DiffChunk, DiffLine, FileStatus, GitStatus } from "$shared/types";
import { ChangeStage } from "$features/file-tracking/types";
import type {
  CommitFile,
  CommitInfo,
  FileChangeStatus,
  TrackedChange,
} from "$features/file-tracking/types";
import type {
  CommitDetailsResult,
  CommitFileDetail,
  GitBranchesResult,
  GitClient,
  GitCommitParams,
  GitDiffsOptions,
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
import { isEventInFamily, listWorkspaceIds, runMutation } from "./live-support";

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

/** Coerce a daemon `git.diffs` line into the renderer `DiffLine`. */
function toDiffLine(raw: unknown): DiffLine {
  const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawType = typeof line.type === "string" ? line.type : "Context";
  const type =
    rawType === "Addition"
      ? LineType.Addition
      : rawType === "Deletion"
        ? LineType.Deletion
        : LineType.Context;
  const out: DiffLine = { type, content: typeof line.content === "string" ? line.content : "" };
  if (typeof line.oldNumber === "number") out.oldNumber = line.oldNumber;
  if (typeof line.newNumber === "number") out.newNumber = line.newNumber;
  return out;
}

/** Map the daemon `git.diffs` bare-array result into renderer `DiffChunk[]`. */
function toDiffChunks(result: unknown): DiffChunk[] {
  const entries = Array.isArray(result) ? result : [];
  const chunks: DiffChunk[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const file = typeof e.path === "string" ? e.path : "";
    if (!file) continue;
    const rawHunks = Array.isArray(e.hunks) ? e.hunks : [];
    const mapped = rawHunks.map((h) => {
      const hunk = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
      return {
        oldStart: Number(hunk.oldStart ?? 0),
        oldLines: Number(hunk.oldLines ?? 0),
        newStart: Number(hunk.newStart ?? 0),
        newLines: Number(hunk.newLines ?? 0),
        lines: Array.isArray(hunk.lines) ? hunk.lines.map(toDiffLine) : [],
      };
    });
    chunks.push({ file, chunks: mapped });
  }
  return chunks;
}

/** Best-effort epoch timestamp from a daemon commit `date` (ISO/RFC string). */
function dateToTimestamp(date: unknown): number {
  if (typeof date !== "string" || !date) return 0;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : 0;
}

/** Map a daemon `git.commits` items entry into the renderer `CommitInfo`. */
function toCommitInfo(raw: unknown): CommitInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hash = typeof r.hash === "string" ? r.hash : "";
  if (!hash) return null;
  const rawFiles = Array.isArray(r.files) ? r.files : [];
  const files: CommitFile[] = rawFiles
    .map((p) => (typeof p === "string" ? ({ path: p } as CommitFile) : null))
    .filter((f): f is CommitFile => f !== null);
  const info: CommitInfo = {
    hash,
    message: typeof r.message === "string" ? r.message : "",
    author: typeof r.author === "string" ? r.author : "",
    timestamp: dateToTimestamp(r.date),
    files,
    stage: "local",
  };
  if (typeof r.email === "string") info.authorEmail = r.email;
  if (typeof r.date === "string") info.date = r.date;
  if (typeof r.agentId === "string") info.agentId = r.agentId;
  if (typeof r.linkedNoteId === "string") info.linkedNoteId = r.linkedNoteId;
  return info;
}

/** Map a daemon `git.commitDetails` entry into a renderer `CommitDetailsResult`. */
function normalizeCommitDetails(
  raw: Record<string, unknown>,
  fallbackHash: string,
): CommitDetailsResult {
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const files: string[] = rawFiles
    .map((p) => (typeof p === "string" ? p : null))
    .filter((p): p is string => p !== null);
  const rawDetails = Array.isArray(raw.fileDetails) ? raw.fileDetails : [];
  const fileDetails: CommitFileDetail[] = rawDetails
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const path = typeof e.path === "string" ? e.path : "";
      if (!path) return null;
      return {
        path,
        additions: typeof e.additions === "number" ? e.additions : 0,
        deletions: typeof e.deletions === "number" ? e.deletions : 0,
      };
    })
    .filter((f): f is CommitFileDetail => f !== null);
  return {
    commitHash: typeof raw.commitHash === "string" ? raw.commitHash : fallbackHash,
    author: typeof raw.author === "string" ? raw.author : "",
    authorEmail: typeof raw.authorEmail === "string" ? raw.authorEmail : "",
    date: typeof raw.date === "string" ? raw.date : "",
    message: typeof raw.message === "string" ? raw.message : "",
    files,
    fileDetails,
  };
}

/** Map a daemon `git.changes` `FileStatus` into the renderer `TrackedChange`. */
function toTrackedChange(raw: unknown): TrackedChange | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === "string" ? r.path : "";
  if (!path) return null;
  const code = typeof r.status === "string" ? r.status.trim() : "";
  const staged = Boolean(r.staged);
  let status: FileChangeStatus | undefined;
  switch (code) {
    case "A":
    case "?":
      status = "added";
      break;
    case "D":
      status = "deleted";
      break;
    case "R":
      status = "renamed";
      break;
    case "M":
    case "C":
      status = "modified";
      break;
    default:
      status = code ? "modified" : undefined;
  }
  return {
    id: path,
    file: path,
    relativePath: path,
    stage: staged ? ChangeStage.Staged : ChangeStage.Unstaged,
    stats: { additions: 0, deletions: 0 },
    ...(status ? { status } : {}),
    attribution: { manual: true, timestamp: Date.now() },
  };
}

export class LiveGitClient implements GitClient {
  async status(workspaceId: string): Promise<GitStatus | null> {
    return fetchStatus(workspaceId);
  }

  // `git.changes` mirrors the working-tree file list from `git.status`; the
  // renderer surface is the same `GitStatus` shape, so reuse `git.status` here
  // (the dedicated `trackedChanges` read below is what consumes `git.changes`).
  async changes(workspaceId: string): Promise<GitStatus | null> {
    return fetchStatus(workspaceId);
  }

  // `git.diffs` (PROTOCOL §5.6) returns per-file hunks. Defaults to the
  // index→workdir (unstaged) diff; `options.staged` selects HEAD→index;
  // `options.commitHash` returns the per-file hunks for
  // `<commitHash>^..<commitHash>` (the commit's own changes vs its first
  // parent). Mapped into renderer `DiffChunk[]`. Errors fold to `[]` so the
  // diff viewer degrades cleanly rather than throwing into the store.
  async diffs(workspaceId: string, options?: GitDiffsOptions): Promise<DiffChunk[]> {
    const params: Record<string, unknown> = { workspaceId };
    if (options?.path) params.path = options.path;
    if (options?.staged === true) params.staged = true;
    if (options?.commitHash) params.commitHash = options.commitHash;
    try {
      const result = await backendRequest<unknown>("git.diffs", params);
      return toDiffChunks(result);
    } catch {
      return [];
    }
  }

  // `git.commitDetails` (PROTOCOL §5.6) returns the metadata + per-file
  // `(additions, deletions)` for one commit. The daemon already degrades
  // non-repo / remote / unknown-hash workspaces to an empty envelope, so we
  // only fold transport failures to `null`.
  async commitDetails(
    workspaceId: string,
    commitHash: string,
  ): Promise<CommitDetailsResult | null> {
    try {
      const result = await backendRequest<Record<string, unknown>>("git.commitDetails", {
        workspaceId,
        commitHash,
      });
      if (!result || typeof result !== "object") return null;
      return normalizeCommitDetails(result, commitHash);
    } catch {
      return null;
    }
  }

  // `git.changes` (PROTOCOL §5.6) returns the working-tree `FileStatus[]` for
  // the workspace. Mapped into a minimal `TrackedChange[]` (path/stage/status);
  // richer fields (`stats`, `hunks`, agent attribution) come from other paths
  // and are intentionally not synthesized here.
  async trackedChanges(workspaceId: string): Promise<TrackedChange[]> {
    try {
      const result = await backendRequest<{ files?: unknown[] }>("git.changes", { workspaceId });
      const files = Array.isArray(result?.files) ? result.files : [];
      return files
        .map(toTrackedChange)
        .filter((c): c is TrackedChange => c !== null);
    } catch {
      return [];
    }
  }

  // `git.commits` (PROTOCOL §5.6) returns a `{ items, nextToken }` page of
  // reverse-chronological history. P0: first page is enough for the renderer
  // (pagination tokens are NOT yet surfaced through the seam).
  async commits(workspaceId: string): Promise<CommitInfo[]> {
    try {
      const result = await backendRequest<{ items?: unknown[] }>("git.commits", { workspaceId });
      const items = Array.isArray(result?.items) ? result.items : [];
      return items.map(toCommitInfo).filter((c): c is CommitInfo => c !== null);
    } catch {
      return [];
    }
  }

  // `git.getBranches` (PROTOCOL §5.6) is path-based, NOT workspace-scoped: the
  // workspace-initializer asks for an arbitrary repo path BEFORE a workspace
  // exists. Maps the daemon `GitBranches` (snake_case fields are serialized as
  // camelCase per the wire model) into the renderer `GitBranchesResult`.
  // Errors (including the daemon's "Unknown or unauthorized repository path"
  // gate rejection) fold to `null` so the caller surfaces a friendly fallback
  // instead of crashing on `result.success` against an undefined payload.
  async getBranches(repoPath: string, includeRemote: boolean): Promise<GitBranchesResult | null> {
    try {
      const result = await backendRequest<Record<string, unknown>>("git.getBranches", {
        repoPath,
        includeRemote,
      });
      if (!result || typeof result !== "object") return null;
      const branches = Array.isArray(result.branches)
        ? result.branches.filter((b): b is string => typeof b === "string")
        : [];
      const remoteBranches = Array.isArray(result.remoteBranches)
        ? result.remoteBranches.filter((b): b is string => typeof b === "string")
        : [];
      return {
        branches,
        remoteBranches,
        currentBranch: typeof result.currentBranch === "string" ? result.currentBranch : "",
        defaultBranch: typeof result.defaultBranch === "string" ? result.defaultBranch : "",
      };
    } catch {
      return null;
    }
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

  // `git.agentCommit` is DESTRUCTIVE: it requires `userRequested: true`. The
  // request is refused upstream (and never hits the daemon) when the caller did
  // not assert user intent, mirroring the `git.commit` guard. The wire method
  // does NOT accept `amend` or `idempotencyKey` (§5.6), and no renderer call
  // site exercises the deprecated `amend` path through this seam, so the
  // `GitCommitParams.amend` field is intentionally not forwarded; reintroduce a
  // `git.commit` fallback here only if a renderer surface starts needing amend.
  async commit(workspaceId: string, params: GitCommitParams): Promise<MutationResult> {
    if (!params.userRequested) {
      return { success: false, error: "git.agentCommit requires userRequested: true." };
    }
    return runMutation("git.agentCommit", {
      workspaceId,
      message: params.message,
      ...(params.files !== undefined ? { files: params.files } : {}),
      userRequested: params.userRequested,
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

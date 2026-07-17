/**
 * Live git domain backed by the intentd daemon.
 *
 * `status` (and `changes`, which mirrors it) resolve via `git.status`, returning
 * the daemon's working-tree summary directly in the renderer `GitStatus` shape.
 * `prStatus` resolves via `pr.status` (the daemon errors when no PR is active, so
 * that is folded to `null`). `diffs` resolves via the additive `git.diffs` read
 * (PROTOCOL §5.6); `trackedChanges` / `commits` resolve via the daemon
 * file-tracking reads `file-tracking.getChanges` / `file-tracking.loadCommits`
 * (PROTOCOL §5.19 — the per-file audit trail with agent attribution, replacing
 * the retired local file-tracking.json store). All are mapped into the renderer
 * `DiffChunk[]` / `TrackedChange[]` / `CommitInfo[]` shapes; transport/daemon
 * errors fold to an empty list so a single failed read does not throw into the
 * store. `subscribe` refetches on `git:*` / `changes:tracked` /
 * `changes:git-status` events (§6.5). `stage`, `commit`, and `pull` are the supported
 * write mutations: `stage` forwards to `git.stage`; `commit` forwards to
 * `git.agentCommit` (the wire-canonical commit method — `git.commit` is
 * deprecated per §5.6); `pull` forwards to the path-based `git.pull`
 * (workspace-create auto-pull). All fold the daemon outcome into a
 * `MutationResult`.
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
  GitBranchStatusResult,
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
  onBackendReconnected,
} from "./backend-transport";
import { isEventInFamily, listWorkspaceIds, runMutation } from "./live-support";

/**
 * Transport timeout for `git.pull` (PROTOCOL §5.6). Longer than the daemon's
 * own 120s pull bound so its structured `{ok:false}` result wins over a
 * transport timeout when a pull runs long — see `pull()` below.
 */
const PULL_TIMEOUT_MS = 150_000;

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

/** Map a §5.19 `CommitWithAttribution` file entry into the renderer `CommitFile`. */
function toCommitFile(raw: unknown): CommitFile | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const path = typeof f.path === "string" ? f.path : "";
  if (!path) return null;
  const file: CommitFile = { path };
  if (typeof f.additions === "number") file.additions = f.additions;
  if (typeof f.deletions === "number") file.deletions = f.deletions;
  if (typeof f.status === "string") file.status = f.status;
  return file;
}

/**
 * Map a daemon `file-tracking.loadCommits` entry (§5.19 `CommitWithAttribution`:
 * hash/message/author/date/filesChanged/isPushed/files?/agentId?/linkedNoteId?)
 * into the renderer `CommitInfo`.
 */
function toCommitInfo(raw: unknown): CommitInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hash = typeof r.hash === "string" ? r.hash : "";
  if (!hash) return null;
  const rawFiles = Array.isArray(r.files) ? r.files : [];
  const files: CommitFile[] = rawFiles
    .map(toCommitFile)
    .filter((f): f is CommitFile => f !== null);
  const isPushed = Boolean(r.isPushed);
  const info: CommitInfo = {
    hash,
    message: typeof r.message === "string" ? r.message : "",
    author: typeof r.author === "string" ? r.author : "",
    timestamp: dateToTimestamp(r.date),
    files,
    stage: isPushed ? "pushed" : "local",
    isPushed,
  };
  if (typeof r.filesChanged === "number") info.filesChanged = r.filesChanged;
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

/** Wire stage values (§5.19) — a 1:1 match with the renderer `ChangeStage` enum. */
const WIRE_CHANGE_STAGES: ReadonlySet<string> = new Set(Object.values(ChangeStage));
const WIRE_CHANGE_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "modified",
  "deleted",
  "renamed",
]);

/**
 * Map a daemon `file-tracking.getChanges` entry (§5.19 `TrackedChange`:
 * id/file/relativePath/stage/status?/stats/attribution) into the renderer
 * `TrackedChange`. The wire shape mirrors the renderer type, so fields are
 * carried through with type guards rather than re-derived.
 */
function toTrackedChange(raw: unknown): TrackedChange | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const file = typeof r.file === "string" ? r.file : "";
  const relativePath = typeof r.relativePath === "string" ? r.relativePath : file;
  if (!file && !relativePath) return null;
  const stage =
    typeof r.stage === "string" && WIRE_CHANGE_STAGES.has(r.stage)
      ? (r.stage as ChangeStage)
      : ChangeStage.Unstaged;
  const status =
    typeof r.status === "string" && WIRE_CHANGE_STATUSES.has(r.status)
      ? (r.status as FileChangeStatus)
      : undefined;
  const rawStats = (r.stats && typeof r.stats === "object" ? r.stats : {}) as Record<
    string,
    unknown
  >;
  const rawAttribution = (
    r.attribution && typeof r.attribution === "object" ? r.attribution : {}
  ) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" && r.id ? r.id : relativePath || file,
    file: file || relativePath,
    relativePath: relativePath || file,
    stage,
    stats: {
      additions: typeof rawStats.additions === "number" ? rawStats.additions : 0,
      deletions: typeof rawStats.deletions === "number" ? rawStats.deletions : 0,
    },
    ...(status ? { status } : {}),
    attribution: {
      ...(rawAttribution.agent && typeof rawAttribution.agent === "object"
        ? { agent: rawAttribution.agent as TrackedChange["attribution"]["agent"] }
        : {}),
      ...(typeof rawAttribution.manual === "boolean" ? { manual: rawAttribution.manual } : {}),
      timestamp:
        typeof rawAttribution.timestamp === "number" ? rawAttribution.timestamp : 0,
    },
    ...(typeof r.commitHash === "string" ? { commitHash: r.commitHash } : {}),
  };
}

/**
 * Validate + trim the explicit-paths param shared by `git.stage`,
 * `git.unstage`, and `git.discard`: empty lists and all-files globs
 * ('.'/'*'/'--all') are rejected upstream (mirroring the daemon contract) so
 * the request is never even sent. `verb` labels the failure message
 * ("Staging"/"Unstaging"/"Discarding").
 */
function cleanExplicitPaths(
  paths: string[],
  verb: string,
): { ok: true; paths: string[] } | { ok: false; failure: MutationResult } {
  const cleaned = paths.map((path) => path.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      ok: false,
      failure: {
        success: false,
        error: `No file paths provided; ${verb.toLowerCase()} requires explicit paths.`,
      },
    };
  }
  if (cleaned.some((path) => path === "." || path === "*" || path.includes("--all"))) {
    return {
      ok: false,
      failure: {
        success: false,
        error: `${verb} all files is not allowed; specify explicit file paths.`,
      },
    };
  }
  return { ok: true, paths: cleaned };
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

  // `file-tracking.getChanges` (PROTOCOL §5.19) returns the daemon's tracked
  // changes `{ changes, truncated, totalCount }` — the per-file audit trail
  // with stats and agent attribution the local file-tracking.json store used
  // to hold. The seam surfaces only `TrackedChange[]`; the pagination envelope
  // (`truncated`/`totalCount`) is not yet threaded through.
  async trackedChanges(workspaceId: string): Promise<TrackedChange[]> {
    try {
      const result = await backendRequest<{ changes?: unknown[] }>("file-tracking.getChanges", {
        workspaceId,
      });
      const changes = Array.isArray(result?.changes) ? result.changes : [];
      return changes
        .map(toTrackedChange)
        .filter((c): c is TrackedChange => c !== null);
    } catch {
      return [];
    }
  }

  // `file-tracking.loadCommits` (PROTOCOL §5.19) returns
  // `{ commits: CommitWithAttribution[], boundarySha: string | null, nextToken: string | null }` — local commits carrying agent
  // provenance (agentId / linkedNoteId) and per-file stats, replacing the
  // attribution-less `git.commits` page for the changes panel.
  // When `includeOlder` is true, returns commits before and including the workspace boundary.
  async commits(workspaceId: string, includeOlder?: boolean): Promise<CommitInfo[]> {
    try {
      const result = await backendRequest<{ commits?: unknown[]; boundarySha?: string | null; nextToken?: string | null }>(
        "file-tracking.loadCommits",
        {
          workspaceId,
          ...(includeOlder !== undefined ? { includeOlder } : {}),
        }
      );
      const commits = Array.isArray(result?.commits) ? result.commits : [];
      return commits.map(toCommitInfo).filter((c): c is CommitInfo => c !== null);
    } catch {
      return [];
    }
  }

  // `file-tracking.loadCommits` with full envelope — returns the boundary SHA
  // alongside the commits for the Changes panel to render the workspace-start marker.
  async commitsWithBoundary(workspaceId: string, includeOlder?: boolean): Promise<{
    commits: CommitInfo[];
    boundarySha: string | null;
    nextToken: string | null;
  }> {
    try {
      const result = await backendRequest<{ commits?: unknown[]; boundarySha?: unknown; nextToken?: unknown }>(
        "file-tracking.loadCommits",
        {
          workspaceId,
          ...(includeOlder !== undefined ? { includeOlder } : {}),
        }
      );
      const commits = Array.isArray(result?.commits) ? result.commits : [];
      // Runtime validation: boundarySha and nextToken must be string | null.
      // Untrusted payloads from backendRequest could send any shape.
      const boundarySha =
        result?.boundarySha === null || typeof result?.boundarySha === "string"
          ? result.boundarySha
          : null;
      const nextToken =
        result?.nextToken === null || typeof result?.nextToken === "string"
          ? result.nextToken
          : null;
      return {
        commits: commits.map(toCommitInfo).filter((c): c is CommitInfo => c !== null),
        boundarySha,
        nextToken,
      };
    } catch {
      return { commits: [], boundarySha: null, nextToken: null };
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

  // `git.branchStatus` (PROTOCOL §5.6) is path-based like `git.getBranches` —
  // the workspace-initializer `BranchSelector` queries an arbitrary repo path
  // before a workspace exists to drive the ahead/behind + uncommitted
  // indicators. Maps the daemon `GitBranchStatus` (snake_case → camelCase per
  // the wire model) into the renderer `GitBranchStatusResult`. Errors
  // (including the known-repo gate rejection) fold to `null` so the seam
  // degrades silently — branch status is informational, never a hard failure.
  async branchStatus(
    repoPath: string,
    branchName: string,
  ): Promise<GitBranchStatusResult | null> {
    try {
      const result = await backendRequest<Record<string, unknown>>("git.branchStatus", {
        repoPath,
        branchName,
      });
      if (!result || typeof result !== "object") return null;
      return {
        branch: typeof result.branch === "string" ? result.branch : branchName,
        currentBranch: typeof result.currentBranch === "string" ? result.currentBranch : "",
        isCurrentBranch: Boolean(result.isCurrentBranch),
        ahead: typeof result.ahead === "number" ? result.ahead : 0,
        behind: typeof result.behind === "number" ? result.behind : 0,
        hasUncommittedChanges: Boolean(result.hasUncommittedChanges),
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
  // even sent. `git.unstage` and `git.discard` share the same explicit-paths
  // contract (§5.6 extensions).
  async stage(workspaceId: string, paths: string[]): Promise<MutationResult> {
    const cleaned = cleanExplicitPaths(paths, "Staging");
    if (!cleaned.ok) return cleaned.failure;
    return runMutation("git.stage", { workspaceId, paths: cleaned.paths });
  }

  // `git.unstage` (PROTOCOL §5.6 extensions) — the inverse of `git.stage`;
  // idempotent on already-unstaged paths.
  async unstage(workspaceId: string, paths: string[]): Promise<MutationResult> {
    const cleaned = cleanExplicitPaths(paths, "Unstaging");
    if (!cleaned.ok) return cleaned.failure;
    return runMutation("git.unstage", { workspaceId, paths: cleaned.paths });
  }

  // `git.discard` (PROTOCOL §5.6 extensions) — DESTRUCTIVE: discards
  // working-tree changes for the given paths (ports the legacy
  // `discardChanges` behind the revert buttons).
  async discard(workspaceId: string, paths: string[]): Promise<MutationResult> {
    const cleaned = cleanExplicitPaths(paths, "Discarding");
    if (!cleaned.ok) return cleaned.failure;
    return runMutation("git.discard", { workspaceId, paths: cleaned.paths });
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

  // `git.pull` (PROTOCOL §5.6) is path-based like `git.getBranches` — the
  // workspace-create auto-pull runs BEFORE the repo is registered as a
  // workspace. Ordinary pull failures (conflicts, unreachable remote, stash
  // recovery) come back as the structured `{ ok: false, error }` result, never
  // a JSON-RPC error; both that and transport/validation errors (bad repoPath
  // → -32602) fold into `{ success: false, error }` so callers drive the
  // PullConflictDialog off the MutationResult without a throw path.
  //
  // Pull is a legitimately-slow network op (remote fetch + rebase/merge) whose
  // daemon-side bound is 120s. Pass a 150s per-call transport timeout — longer
  // than the daemon's bound — so the daemon's structured `{ok:false}` result
  // wins over a flat 30s JSON-RPC transport timeout when a pull genuinely runs
  // long.
  async pull(repoPath: string, branchName: string): Promise<MutationResult> {
    try {
      const result = await backendRequest<Record<string, unknown>>(
        "git.pull",
        { repoPath, branchName },
        { timeoutMs: PULL_TIMEOUT_MS },
      );
      if (result && typeof result === "object" && result.ok === true) return { success: true };
      const error =
        result && typeof result === "object" && typeof result.error === "string" && result.error
          ? result.error
          : "Failed to pull changes";
      return { success: false, error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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

    const doSubscribe = () =>
      backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: [
          "git:commit",
          "git:push",
          "git:pull",
          "git:branch",
          "git:merge",
          "changes:tracked",
          "changes:git-status",
        ],
      })
        .then((result) => {
          subscriptionId = result?.subscriptionId;
          if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
        })
        .catch(() => {
          // Without a daemon subscription we still serve the initial snapshot.
        });

    doSubscribe();

    // On reconnect the daemon dropped its subscription registry (RESUB-1);
    // the notification handler is still wired, so we only need to re-issue
    // the subscribe and refresh the snapshot to converge on anything missed
    // during the outage.
    const offReconnect = onBackendReconnected(() => {
      subscriptionId = undefined;
      void doSubscribe();
      emit();
    });

    return () => {
      disposed = true;
      off();
      offReconnect();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}

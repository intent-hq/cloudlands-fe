/**
 * Workspace summaries IPC bridge — routes the legacy renderer→main on-demand
 * summary reads onto the daemon so the daemon stays the single git execution
 * locus (the renderer never spawns git itself).
 *
 * Channels served here and their daemon arms:
 *  - `workspace:get-diff-summary` → `git.status` (PROTOCOL §5.6) for the
 *    changed-file set (staged + unstaged + untracked, deduped by path — the
 *    legacy `git diff --name-only HEAD` ∪ `git ls-files --others` union) and
 *    `git.numstat` (§5.6, working-tree HEAD→workdir form) for line stats.
 *    Numstat failures are non-fatal (legacy parity: stats fold to 0s).
 *  - `workspace:get-git-summary`  → `workspace.get` (§5.1) for the
 *    worktreePath/baseRef, `git.branchStatus` (§5.6) for ahead/behind vs the
 *    base ref, `git.status` for the unpushed probe, and `git.commits` (§5.6)
 *    for the recent-commit titles (capped at 6, legacy parity).
 *
 * Both handlers preserve the legacy CommandResponse envelope their call site
 * (workspace.client.ts invokeFresh → normalizeResponse) consumes:
 * `{ success: true, data }` with `data: null` for the legacy
 * "no summary available" undefined — daemon rejections fold to
 * `{ success: false, error }`, never a throw. Handlers are registered at
 * import time (host-bridge idiom).
 *
 * Documented approximations vs the legacy main-process helpers
 * (features/workspace/main/workspace-summaries.ts):
 *  - `hasUnpushed` reads `git.status.ahead` (upstream-relative); when that
 *    call fails, it falls back to the base-ref ahead count (the legacy
 *    no-upstream fallback). A never-pushed branch on a daemon reporting
 *    upstream ahead 0 reads false where legacy read true.
 *  - `commits` walks reverse-chronologically from HEAD (`git.commits`) capped
 *    at min(ahead, 6) instead of the exact `<base>..HEAD` range — identical
 *    on linear history.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Daemon `git.status` result subset consumed here (§5.6). */
interface GitStatusResult {
  ahead?: number;
  behind?: number;
  files?: { path: string }[];
  /** Additive truncation markers (v8.4): `files` caps at 5000 entries. */
  filesTruncated?: boolean;
  totalFiles?: number;
}

/** Daemon `git.numstat` result rows (§5.6, bare array). */
type GitNumstatResult = { filePath: string; additions: number; deletions: number }[];

/** Daemon `workspace.get` result subset consumed here (§5.1). */
interface WorkspaceGetResult {
  workspace?: { worktreePath?: string; baseRef?: string };
}

/** Daemon `git.branchStatus` result subset consumed here (§5.6). */
interface GitBranchStatusResult {
  ahead?: number;
  behind?: number;
}

/** Daemon `git.commits` result subset consumed here (§5.6). */
interface GitCommitsResult {
  items?: { sha?: string; message?: string }[];
}

/** Local git ops keep the legacy 60s bound — large repos can outrun the transport default. */
const LOCAL_TIMEOUT_MS = 60_000;

/** Legacy commit-title cap (workspace-summaries.ts `git log -n 6`). */
const MAX_SUMMARY_COMMITS = 6;

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireWorkspaceId(arg: unknown): string | null {
  const workspaceId = asRecord(arg).workspaceId;
  return typeof workspaceId === 'string' && workspaceId ? workspaceId : null;
}

// ── workspace:get-diff-summary → git.status + git.numstat (§5.6) ──

registerMockIpcHandler(IPC_CHANNELS.WORKSPACE.GET_DIFF_SUMMARY, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  try {
    const status = await backendRequest<GitStatusResult>('git.status', { workspaceId });
    const files = Array.isArray(status?.files) ? status.files : [];
    // Truncated status (v8.4: files caps at 5000) carries the true count in
    // totalFiles; otherwise count the deduped paths (legacy parity).
    const totalFiles =
      status?.filesTruncated === true && typeof status.totalFiles === 'number'
        ? status.totalFiles
        : new Set(files.map((f) => f.path)).size;
    if (totalFiles === 0) {
      // Legacy parity: 0 changes → no summary (undefined → null on the wire).
      return { success: true, data: null };
    }
    let totalAdditions = 0;
    let totalDeletions = 0;
    try {
      // Working-tree numstat (HEAD→workdir, `staged` omitted) — the legacy
      // `git diff --numstat HEAD`. Untracked files carry no line stats there
      // either, so counts match the legacy summary.
      const numstat = await backendRequest<GitNumstatResult>(
        'git.numstat',
        { workspaceId },
        { timeoutMs: LOCAL_TIMEOUT_MS },
      );
      for (const row of Array.isArray(numstat) ? numstat : []) {
        totalAdditions += Number.isFinite(row.additions) ? row.additions : 0;
        totalDeletions += Number.isFinite(row.deletions) ? row.deletions : 0;
      }
    } catch {
      // Non-fatal (legacy parity) — the summary just carries no line stats.
    }
    return {
      success: true,
      data: {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        totalFiles,
        totalAdditions,
        totalDeletions,
        files: [],
      },
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── workspace:get-git-summary → workspace.get + git.branchStatus + git.status + git.commits ──

registerMockIpcHandler(IPC_CHANNELS.WORKSPACE.GET_GIT_SUMMARY, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  try {
    const { workspace } = await backendRequest<WorkspaceGetResult>('workspace.get', {
      workspaceId,
    });
    const worktreePath = workspace?.worktreePath;
    if (!worktreePath) {
      // Legacy parity: no worktree → no summary.
      return { success: true, data: null };
    }
    const baseRef = workspace?.baseRef || 'main';

    let ahead = 0;
    let behind = 0;
    try {
      const branchStatus = await backendRequest<GitBranchStatusResult>('git.branchStatus', {
        repoPath: worktreePath,
        branchName: baseRef,
      });
      ahead = branchStatus?.ahead ?? 0;
      behind = branchStatus?.behind ?? 0;
    } catch {
      // Legacy parity (`|| echo "0"`): an unresolvable base folds to 0/0.
    }

    if (ahead === 0 && behind === 0) {
      // Legacy parity: even with the base → no summary.
      return { success: true, data: null };
    }

    const [statusAhead, commits] = await Promise.all([
      backendRequest<GitStatusResult>('git.status', { workspaceId })
        .then((status) => status?.ahead ?? 0)
        .catch(() => null),
      ahead > 0
        ? backendRequest<GitCommitsResult>('git.commits', {
            workspaceId,
            limit: Math.min(ahead, MAX_SUMMARY_COMMITS),
          })
            .then((result) =>
              (result?.items ?? []).map((item) => ({
                sha: item.sha ?? '',
                title: (item.message ?? '').split('\n')[0] ?? '',
              })),
            )
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    // Upstream-relative unpushed probe; a failed status read falls back to
    // the base-ref ahead count (the legacy no-upstream fallback).
    const hasUnpushed = statusAhead === null ? ahead > 0 : statusAhead > 0;

    return { success: true, data: { ahead, behind, hasUnpushed, commits } };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

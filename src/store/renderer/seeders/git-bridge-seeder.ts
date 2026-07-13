/**
 * Git IPC bridge — routes the legacy renderer→main `git:*` / `git-tracking:*`
 * working-copy operations onto the daemon so the daemon host stays the single
 * execution locus (the renderer never spawns git itself).
 *
 * Channels served here and their daemon arms:
 *  - `git:push`                          → `git.push` (PROTOCOL §5.6)
 *  - `git:fetch`                         → `git.fetch` (§5.6)
 *  - `git:stage-hunk` / `git:unstage-hunk` → `git.stageHunk` / `git.unstageHunk`
 *    (§5.6). The daemon streams the patch to `git apply --cached [--reverse]`
 *    on stdin with the direct-then-`--3way` fallback; the legacy content-based
 *    unstage fallback is not replicated.
 *  - `workspace:rename-branch`            → `git.renameBranch` (§5.6). The
 *    daemon rename requires the old branch name, so this handler first reads
 *    the current branch via `git.status` (§5.6) and forwards it.
 *  - `git:numstat` + branch-base `git:diff` → the legacy merge-base boundary
 *    resolution (`origin/<base>` → `<base>`, `--is-ancestor` sha fallback)
 *    still runs through the daemon-owned exec (`host.exec`, §5.14) because
 *    there is no dedicated daemon RPC for them yet; unresolvable boundaries
 *    fold to an empty result exactly like the legacy handlers. Working-tree
 *    `git:diff` reads were migrated to the daemon `git.diffs` (§5.6) and are
 *    rejected here.
 *  - `git:isRepository`                  → `host.directoryStatus.isGitRepo`.
 *  - `git-tracking:get-remote-url`       → `git -C <repoPath> config --get
 *    remote.origin.url` (path-based: the picker probes repos that predate any
 *    workspace, so no workspace cwd guard applies).
 *
 * Every handler preserves the legacy `{ success, data?, error? }` envelope its
 * call sites already consume — daemon rejections fold to `{ success: false,
 * error }`, never a throw. Handlers are registered at import time (host-bridge
 * idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

/** Daemon `host.directoryStatus` result subset consumed here. */
interface HostDirectoryStatusResult {
  exists: boolean;
  isGitRepo: boolean;
}

/** Daemon `git.status` result subset consumed by the rename-branch handler. */
interface GitStatusResult {
  branch?: string;
}

/** Local git reads used by the numstat / branch-base diff shims. */
const LOCAL_TIMEOUT_MS = 60_000;

/** Legacy `git.service.push` timeout — network op can outrun the transport default. */
const PUSH_TIMEOUT_MS = 300_000;

/** Legacy `git.service.fetch` timeout — network op can outrun the transport default. */
const FETCH_TIMEOUT_MS = 60_000;

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run git in the workspace root on the daemon host (`cwd` containment §5.14). */
async function gitExec(
  workspaceId: string,
  args: string[],
  timeoutMs = LOCAL_TIMEOUT_MS,
): Promise<HostExecResult> {
  return await backendRequest<HostExecResult>('host.exec', {
    command: 'git',
    args,
    cwd: '.',
    workspaceId,
    timeoutMs,
  });
}

/** Fold a non-zero exec into the legacy error string (stderr-first). */
function execError(result: HostExecResult, fallback: string): string {
  if (result.timedOut) return `${fallback}: timed out`;
  return result.stderr.trim() || result.stdout.trim() || fallback;
}

function requireWorkspaceId(arg: unknown): string | null {
  const workspaceId = asRecord(arg).workspaceId;
  return typeof workspaceId === 'string' && workspaceId ? workspaceId : null;
}

// ── git:push / git:fetch → git.push / git.fetch (§5.6) ──

registerMockIpcHandler(IPC_CHANNELS.GIT.PUSH, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  const force = asRecord(arg).force === true;
  try {
    await backendRequest('git.push', { workspaceId, force }, { timeoutMs: PUSH_TIMEOUT_MS });
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler(IPC_CHANNELS.GIT.FETCH, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  try {
    await backendRequest('git.fetch', { workspaceId }, { timeoutMs: FETCH_TIMEOUT_MS });
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── git:stage-hunk / git:unstage-hunk → git.stageHunk / git.unstageHunk (§5.6) ──

async function handleHunk(arg: unknown, reverse: boolean): Promise<unknown> {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  const record = asRecord(arg);
  const filePath = record.filePath;
  const hunkPatch = record.hunkPatch;
  if (typeof filePath !== 'string' || !filePath) {
    return { success: false, error: 'filePath is required' };
  }
  if (typeof hunkPatch !== 'string' || !hunkPatch) {
    return { success: false, error: 'hunkPatch is required' };
  }
  const method = reverse ? 'git.unstageHunk' : 'git.stageHunk';
  try {
    await backendRequest(method, { workspaceId, filePath, hunkPatch });
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

registerMockIpcHandler(IPC_CHANNELS.GIT.STAGE_HUNK, (arg) => handleHunk(arg, false));
registerMockIpcHandler(IPC_CHANNELS.GIT.UNSTAGE_HUNK, (arg) => handleHunk(arg, true));

// ── Branch boundary resolution (shared by git:numstat + branch-base git:diff) ──

/**
 * Legacy `resolveBranchBoundary` parity (git.service.ts): prefer the
 * merge-base of `targetRef` and the base ref (trying `origin/<base>` before
 * the bare ref name), falling back to `baseCommitSha` only when it is an
 * ancestor of `targetRef`. Returns null when no boundary can be resolved.
 */
async function resolveBranchBoundary(
  workspaceId: string,
  baseRef: string | undefined,
  baseCommitSha: string | undefined,
  targetRef: string,
): Promise<string | null> {
  if (baseRef) {
    const refsToTry = baseRef.includes('/') ? [baseRef] : [`origin/${baseRef}`, baseRef];
    for (const ref of refsToTry) {
      const verify = await gitExec(workspaceId, ['rev-parse', '--verify', ref]);
      if (verify.exitCode !== 0) continue;
      const mergeBase = await gitExec(workspaceId, ['merge-base', targetRef, ref]);
      const sha = mergeBase.stdout.trim();
      if (mergeBase.exitCode === 0 && sha) return sha;
    }
  }
  if (baseCommitSha) {
    const ancestor = await gitExec(workspaceId, [
      'merge-base',
      '--is-ancestor',
      baseCommitSha,
      targetRef,
    ]);
    if (ancestor.exitCode === 0) return baseCommitSha;
  }
  return null;
}

// ── git:numstat ──

/** Legacy `parseNumstat` parity — binary entries (`-\t-\tpath`) fold to 0/0. */
function parseNumstat(
  output: string,
): Array<{ filePath: string; additions: number; deletions: number }> {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
      return {
        filePath: pathParts.join('\t'),
        additions: Number.parseInt(rawAdditions, 10) || 0,
        deletions: Number.parseInt(rawDeletions, 10) || 0,
      };
    });
}

registerMockIpcHandler(IPC_CHANNELS.GIT.NUMSTAT, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  const params = asRecord(arg);
  const staged = typeof params.staged === 'boolean' ? params.staged : undefined;
  const baseRef = typeof params.baseRef === 'string' && params.baseRef ? params.baseRef : undefined;
  const baseCommitSha =
    typeof params.baseCommitSha === 'string' && params.baseCommitSha
      ? params.baseCommitSha
      : undefined;
  const targetRef =
    typeof params.targetRef === 'string' && params.targetRef ? params.targetRef : 'HEAD';
  try {
    // Legacy `buildNumstatArgs` parity: boundary range > --cached > HEAD.
    const args = ['diff', '--numstat'];
    if (baseRef || baseCommitSha) {
      const boundary = await resolveBranchBoundary(workspaceId, baseRef, baseCommitSha, targetRef);
      if (!boundary) return { success: true, data: [] };
      args.push(`${boundary}..${targetRef}`);
    } else if (staged === true) {
      args.push('--cached');
    } else if (staged !== false) {
      args.push('HEAD');
    }
    const result = await gitExec(workspaceId, args);
    if (result.exitCode !== 0) {
      return { success: false, error: execError(result, 'Failed to get numstat') };
    }
    return { success: true, data: parseNumstat(result.stdout) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── git:diff (branch-base committed diff only) ──

/** `git show <ref>:<path>`; a path missing at the ref folds to "" (legacy parity). */
async function showFileAt(workspaceId: string, ref: string, filePath: string): Promise<string> {
  const result = await gitExec(workspaceId, ['show', `${ref}:${filePath}`]);
  return result.exitCode === 0 ? result.stdout : '';
}

registerMockIpcHandler(IPC_CHANNELS.GIT.DIFF, async (arg) => {
  const workspaceId = requireWorkspaceId(arg);
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  const params = asRecord(arg);
  const baseRef = typeof params.baseRef === 'string' && params.baseRef ? params.baseRef : undefined;
  const baseCommitSha =
    typeof params.baseCommitSha === 'string' && params.baseCommitSha
      ? params.baseCommitSha
      : undefined;
  if (!baseRef && !baseCommitSha) {
    // Working-tree diffs migrated to the daemon `git.diffs` (PROTOCOL §5.6).
    return { success: false, error: 'Branch base information is required' };
  }
  const targetRef =
    typeof params.targetRef === 'string' && params.targetRef ? params.targetRef : 'HEAD';
  const paths = Array.isArray(params.paths)
    ? params.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : undefined;
  try {
    const boundary = await resolveBranchBoundary(workspaceId, baseRef, baseCommitSha, targetRef);
    if (!boundary) return { success: true, data: [] };

    const nameArgs = ['diff', '--name-only', `${boundary}..${targetRef}`];
    if (paths && paths.length > 0) nameArgs.push('--', ...paths);
    const nameResult = await gitExec(workspaceId, nameArgs);
    if (nameResult.exitCode !== 0) {
      return { success: false, error: execError(nameResult, 'Failed to get branch-base diff') };
    }
    const files = nameResult.stdout.trim().split('\n').filter(Boolean);

    // The branch-base consumer (TrackedChangeDiffViewer via
    // batchedGitBranchBaseDiff) renders from oldContent/newContent only, so
    // each chunk carries the two full-file sides at the boundary and target.
    const data = await Promise.all(
      files.map(async (file) => {
        const [oldContent, newContent] = await Promise.all([
          showFileAt(workspaceId, boundary, file),
          showFileAt(workspaceId, targetRef, file),
        ]);
        return { file, chunks: [], oldContent, newContent };
      }),
    );
    return { success: true, data };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── git:isRepository ──

registerMockIpcHandler(IPC_CHANNELS.GIT_EXT.IS_REPOSITORY, async (arg) => {
  const path = asRecord(arg).path;
  if (typeof path !== 'string' || !path) return { success: false, error: 'path is required' };
  try {
    const status = await backendRequest<HostDirectoryStatusResult>('host.directoryStatus', {
      path,
    });
    // The caller (workspace-validation.ts) reads `isRepository` off the top
    // level of the response; `data` keeps the legacy `{ success, data }` pair.
    const isRepository = status?.isGitRepo === true;
    return { success: true, isRepository, data: isRepository };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── git-tracking:get-remote-url ──

registerMockIpcHandler(IPC_CHANNELS.GIT_TRACKING.GET_REMOTE_URL, async (arg) => {
  const repoPath = asRecord(arg).repoPath;
  if (typeof repoPath !== 'string' || !repoPath) {
    return { success: false, error: 'repoPath is required' };
  }
  try {
    // Path-based (`git -C`): the onboarding/initializer pickers probe repos
    // that predate any workspace, so there is no workspace cwd to contain.
    const result = await backendRequest<HostExecResult>('host.exec', {
      command: 'git',
      args: ['-C', repoPath, 'config', '--get', 'remote.origin.url'],
      timeoutMs: LOCAL_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      // Legacy parity: no origin remote is a soft empty result, not an error.
      return { success: true, data: { remoteUrl: '', owner: null, repo: null } };
    }
    const remoteUrl = result.stdout.trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return { success: true, data: { remoteUrl, owner: match[1], repo: match[2] } };
    }
    return { success: true, data: { remoteUrl, owner: null, repo: null } };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── workspace:rename-branch → git.renameBranch (§5.6) ──

// WorkspaceSidebarHeader / BranchDisplay rename the CURRENT worktree branch
// and then persist the new name onto the Workspace themselves through
// workspaceClient.update (daemon `workspace.update`, PROTOCOL §5.1). The
// daemon `git.renameBranch` needs the old branch name, so this handler
// reads it from `git.status` before issuing the rename. Callers check
// `.success` and toast `error`.
registerMockIpcHandler(IPC_CHANNELS.WORKSPACE.RENAME_BRANCH, async (arg) => {
  const record = asRecord(arg);
  const workspaceId = typeof record.id === 'string' && record.id ? record.id : null;
  const newBranchName =
    typeof record.newBranchName === 'string' ? record.newBranchName.trim() : '';
  if (!workspaceId) return { success: false, error: 'Invalid workspace ID' };
  if (!newBranchName) return { success: false, error: 'Invalid branch name' };
  try {
    const status = await backendRequest<GitStatusResult>('git.status', { workspaceId });
    const oldBranchName = status?.branch;
    if (!oldBranchName) {
      return { success: false, error: 'Failed to rename branch: current branch is unknown' };
    }
    await backendRequest('git.renameBranch', {
      workspaceId,
      oldBranchName,
      newBranchName,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

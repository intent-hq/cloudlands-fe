/**
 * Host IPC bridge — routes legacy renderer→main `system:*` / `file:*` host
 * probes to the daemon-host `host.*` JSON-RPC surface (PROTOCOL §host).
 *
 * The renderer's `invoke()` resolves through the in-memory mock IPC router
 * (`$shared/ipc-mock-router`), not the real Electron preload bridge — so the
 * main-process handlers in `features/system/main/system.ipc.ts` +
 * `features/file/main/file.ipc.ts` that already delegate to `host.checkGit` /
 * `host.directoryStatus` (cloudlands-fe PR #5) were never reached from the
 * renderer. The fallthrough returned `undefined`, which made
 * `CompactWorkspaceInitializer`'s git probe report `gitAvailable:false` and
 * every `RepoSelector` / `LocalRepoTab` / `ProjectPickerMessage` directory
 * status check resolve to `null`.
 *
 * Per the integration principle BE = source of truth: each handler forwards
 * to the canonical daemon RPC (`host.checkGit` / `host.directoryStatus`) and
 * wraps the raw daemon response in the `{ success, data }` envelope the
 * existing call sites already consume — never synthesizing data.
 *
 * Handlers are registered at import time (mirroring the
 * `agent-ipc-bridge-seeder` idiom) so the very first home-screen mount sees
 * a real git-availability + directory-status answer.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { backendRequest } from "$lib/client/live/backend-transport";

/** Daemon `host.checkGit` response shape (intent-transport host_ops.rs §host). */
interface HostCheckGitResult {
  available: boolean;
  version?: string;
  path?: string;
}

/** Daemon `host.directoryStatus` response shape (intent-transport host_ops.rs §host). */
interface HostDirectoryStatusResult {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  isSubdirectoryOfGitRepo: boolean;
  path: string;
  parentGitRoot?: string;
  relativePathFromGitRoot?: string;
}

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
}

/**
 * `system:check-git` → daemon `host.checkGit`.
 *
 * Call sites (e.g. `CompactWorkspaceInitializer.svelte`) read
 * `result.data.available` + `result.data.version`, so we forward the daemon
 * body verbatim under `data`. Any failure folds to `{ available:false }` (the
 * banner-suppressed default) to preserve the prior IPC contract: a missing
 * git binary is never an RPC error.
 */
registerMockIpcHandler(IPC_CHANNELS.SYSTEM.CHECK_GIT, async () => {
  try {
    const result = await backendRequest<HostCheckGitResult>("host.checkGit");
    const available = result?.available === true;
    const version = typeof result?.version === "string" ? result.version : undefined;
    return {
      success: true,
      data: available ? { available: true, version } : { available: false },
    };
  } catch {
    return { success: true, data: { available: false } };
  }
});

/**
 * `file:getDirectoryStatus` → daemon `host.directoryStatus`.
 *
 * Forwards the FE-supplied `{ path }` and surfaces the daemon's
 * `{ exists, isDirectory, isEmpty, isGitRepo, isSubdirectoryOfGitRepo, path,
 * parentGitRoot?, relativePathFromGitRoot? }` shape under `data`. Call sites
 * gate on `result.success && result.data`, so an empty/invalid `path` or a
 * daemon error surfaces as `{ success:false, error }` and the caller falls
 * back to its own null-handling path.
 */
registerMockIpcHandler(IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS, async (arg) => {
  const params = asRecord(arg);
  const rawPath = params.path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (!path) {
    return { success: false, error: "path is required" };
  }
  try {
    const result = await backendRequest<HostDirectoryStatusResult>(
      "host.directoryStatus",
      { path },
    );
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

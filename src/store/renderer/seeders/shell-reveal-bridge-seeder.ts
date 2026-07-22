/**
 * Shell reveal bridge — routes `shell:showItemInFolder` (the "Reveal in
 * Finder/Explorer/file manager" affordance in OpenComboButton /
 * WorkspaceActionsMenu / PanelTabBar / VirtualizedFileTree / CodeEditor /
 * PullConflictDialog) to a daemon-host reveal via `host.exec`
 * (PROTOCOL §5.14), replacing the retired allowlist absence that made the
 * affordance a silent no-op.
 *
 * A file-manager reveal only makes sense when the daemon host IS the user's
 * machine, so the handler is locality-gated on the daemon's own §5.14 signal:
 * `system.status` → `host.locality` (UDS ⇒ `local`, WS ⇒ `remote`). On a
 * remote connection the handler THROWS — the UI already hides the affordance
 * via `selectIsDaemonLocal`, and a caller that reaches the channel anyway
 * gets a loud rejection (toast/log), never a fake success. The same
 * `system.status` response supplies `host.os` for the platform argv:
 *
 *  - macos:   `open -R <path>`            (Finder, selects the item)
 *  - windows: `explorer /select,<path>`   (Explorer; exits 1 even on success)
 *  - linux+:  `xdg-open <parent dir>`     (best effort — no select flag)
 *
 * Handlers are registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { backendRequest } from '$lib/client/live/backend-transport';

/** `system.status` host block (PROTOCOL §5.7 — os + per-connection locality). */
interface SystemStatusHostInfo {
  os: string;
  locality: 'local' | 'remote';
}

/** `system.status` result subset this bridge consumes. */
interface SystemStatusResult {
  host?: SystemStatusHostInfo;
}

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

/** A reveal spawns a GUI file manager — fast, but allow for cold starts. */
const REVEAL_TIMEOUT_MS = 10_000;

/** Transport-timeout headroom over the daemon-side exec bound, so the
 * daemon's structured `timedOut` result wins over a client-side
 * `JSON-RPC request timed out` rejection (pi-mcp-bridge-seeder idiom). */
const TRANSPORT_HEADROOM_MS = 5_000;

/** Containing directory of a POSIX `path` (this helper is only reached from
 * the Linux/default branch, where `\` is a legal filename character — NOT a
 * separator). A trailing-separator input folds to the entry itself sans
 * separator; a separator-less input (unreachable — callers pass absolute
 * paths) falls through unchanged. */
function parentDirectory(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const separatorIndex = trimmed.lastIndexOf('/');
  if (separatorIndex > 0) return trimmed.slice(0, separatorIndex);
  if (separatorIndex === 0) return '/';
  return trimmed || path;
}

/** Platform reveal argv (argv-based `host.exec`, no shell — PROTOCOL §5.14). */
function revealCommand(
  os: string,
  path: string,
): { command: string; args: string[]; successExitCodes: readonly number[] } {
  switch (os) {
    case 'macos':
      return { command: 'open', args: ['-R', path], successExitCodes: [0] };
    case 'windows':
      // Explorer exits 1 even when the window opens — tolerate it. Lossy:
      // exit 1 also covers a nonexistent path (Explorer opens a default
      // folder instead), and `/select,` mis-parses comma-containing paths.
      // Both are inherent to argv-exec'd explorer (Electron sidesteps them
      // via SHOpenFolderAndSelectItems, unavailable to a daemon-side exec).
      return { command: 'explorer', args: [`/select,${path}`], successExitCodes: [0, 1] };
    default:
      // No portable select flag on Linux/BSD — open the containing directory.
      return { command: 'xdg-open', args: [parentDirectory(path)], successExitCodes: [0] };
  }
}

/**
 * `shell:showItemInFolder` → locality-gated `host.exec` reveal. Failures
 * THROW so the mock router rejects and the call sites' catch blocks surface
 * the error (toast/log) instead of a silent no-op.
 */
registerMockIpcHandler('shell:showItemInFolder', async (arg) => {
  const params = (arg && typeof arg === 'object' ? arg : {}) as Record<string, unknown>;
  const path = typeof params.path === 'string' ? params.path : '';
  if (!path) throw new Error('Missing required parameter: path');

  const status = await backendRequest<SystemStatusResult>('system.status');
  const host = status?.host;
  if (!host) {
    // Older daemon without the §5.7 host block — don't mis-diagnose as remote.
    throw new Error(
      'The daemon does not report host info (older intentd?) — cannot verify it runs on this machine',
    );
  }
  if (host.locality !== 'local') {
    throw new Error(
      'Reveal in file manager is only available when the daemon runs on this machine',
    );
  }

  const { command, args, successExitCodes } = revealCommand(host.os, path);
  const result = await backendRequest<HostExecResult>(
    'host.exec',
    { command, args, timeoutMs: REVEAL_TIMEOUT_MS },
    { timeoutMs: REVEAL_TIMEOUT_MS + TRANSPORT_HEADROOM_MS },
  );
  if (result.timedOut) {
    throw new Error(`${command} timed out revealing ${path}`);
  }
  if (!successExitCodes.includes(result.exitCode)) {
    throw new Error(result.stderr || `${command} exited with code ${result.exitCode}`);
  }
  return { success: true };
});

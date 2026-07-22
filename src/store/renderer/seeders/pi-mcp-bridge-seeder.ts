/**
 * Pi MCP adapter bridge — routes `pi:check-mcp-adapter` and
 * `pi:install-mcp-adapter` to real daemon probes (`host.findBinary` +
 * `host.exec`, PROTOCOL §5.14) instead of the retired hard-coded allowlist
 * values (check always `false`, install a shaped failure), which left the
 * ProviderSelector adapter warning permanently rendered and its Install
 * button a no-op.
 *
 * Mirrors the main-process semantics in `features/pi/main/pi-resolver.ts`
 * (isPiMcpAdapterInstalled / installPiMcpAdapter), which the renderer cannot
 * reach in this mock-router build. The main resolver's settings.json
 * fast-path (`~/.pi/agent/settings.json` `packages[]`) is not portable to
 * the renderer — there is no daemon file surface for the host home dir — so
 * the bridge uses the resolver's own compatibility fallback as the primary
 * probe: `pi list` on the daemon host, matching `pi-mcp-adapter` lines.
 *
 *  - check:   `pi list` via host.exec (10s). Missing pi CLI, non-zero exit,
 *             timeout, or RPC failure ⇒ `false` (bare boolean channel —
 *             `false` renders the install affordance honestly).
 *  - install: `pi install npm:pi-mcp-adapter` via host.exec (120s),
 *             returning the caller's `{ success, error? }` shape.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom).
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { PI_CHANNELS } from '$shared/ipc/channels';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Daemon `host.findBinary` result shape (host_ops.rs §host). */
interface HostCheckResult {
  available: boolean;
  version?: string;
  path?: string;
}

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter';
const PI_MCP_ADAPTER_INSTALL_SOURCE = `npm:${PI_MCP_ADAPTER_PACKAGE}`;

/** `pi list` is a fast read (matches pi-resolver's fallback probe timeout). */
const CHECK_TIMEOUT_MS = 10_000;
/** `pi install` downloads from npm (matches pi-resolver's install timeout). */
const INSTALL_TIMEOUT_MS = 120_000;

/** Resolve the `pi` CLI on the daemon host. Null when absent or RPC fails.
 * The RPC result is untrusted: only a non-empty string `path` (trimmed) is
 * accepted as the exec command. */
async function findPiPath(): Promise<string | null> {
  try {
    const found = await backendRequest<HostCheckResult>('host.findBinary', { name: 'pi' });
    if (found?.available !== true || typeof found.path !== 'string') return null;
    const path = found.path.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** One-shot exec on the daemon host (argv-based, no shell — PROTOCOL §5.14). */
async function hostExec(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<HostExecResult> {
  return await backendRequest<HostExecResult>('host.exec', { command, args, timeoutMs });
}

/**
 * `pi:check-mcp-adapter` — `pi list` on the daemon host, matching
 * pi-mcp-adapter lines. Any failure (no pi CLI, non-zero exit, timeout, RPC
 * error) resolves `false`: the install affordance renders and the user can
 * act, rather than a fake positive hiding a missing adapter.
 */
registerMockIpcHandler(PI_CHANNELS.CHECK_MCP_ADAPTER, async () => {
  const piPath = await findPiPath();
  if (!piPath) return false;
  try {
    const result = await hostExec(piPath, ['list'], CHECK_TIMEOUT_MS);
    if (result.timedOut || result.exitCode !== 0) return false;
    return result.stdout.split(/\r?\n/).some((line) => line.includes(PI_MCP_ADAPTER_PACKAGE));
  } catch {
    return false;
  }
});

/**
 * `pi:install-mcp-adapter` — `pi install npm:pi-mcp-adapter` on the daemon
 * host, preserving the caller's `{ success, error? }` shape
 * (installPiMcpAdapter in pi-models.client.ts surfaces `error` next to the
 * install affordance).
 */
registerMockIpcHandler(PI_CHANNELS.INSTALL_MCP_ADAPTER, async () => {
  const piPath = await findPiPath();
  if (!piPath) {
    return { success: false, error: 'Pi CLI not found. Please install Pi first.' };
  }
  try {
    const result = await hostExec(
      piPath,
      ['install', PI_MCP_ADAPTER_INSTALL_SOURCE],
      INSTALL_TIMEOUT_MS,
    );
    if (result.timedOut) {
      return { success: false, error: 'pi install timed out' };
    }
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `pi install exited with code ${result.exitCode}`,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install pi-mcp-adapter',
    };
  }
});

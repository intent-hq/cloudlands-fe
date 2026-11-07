/**
 * Detect whether a daemon runs as a full backend or as a node (PROTOCOL
 * `methods/nodes.md` → "Reported daemon mode"). The reported
 * `client.hello` `server.daemonMode` wins; older daemons omit it, so the
 * client probes once with a method outside the node-mode allowlist (`workspace.get`). A
 * `-32003` refusal with `data.code: "node-mode"` means node, any daemon answer
 * means regular, and a transport failure leaves the mode unknown.
 */

import { classifyStartupReply } from '$shared/daemon-startup';
import { isDaemonMode, type DaemonMode } from '$shared/types/connections';

// A cheap read outside the node-mode allowlist: a regular daemon answers it
// with a not-found or invalid-params error, which still means regular.
const PROBE_METHOD = 'workspace.get';
const PROBE_PARAMS = { workspaceId: '' };
const PROBE_TIMEOUT_MS = 10_000;

type Request = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** `server.daemonMode` from a `client.hello` result, or null when absent or unknown. */
export function reportedDaemonMode(hello: unknown): DaemonMode | null {
  if (!record(hello) || !record(hello.server)) return null;
  const mode = hello.server.daemonMode;
  return isDaemonMode(mode) ? mode : null;
}

/** The reported mode, else the refusal probe; null while unknown. */
export async function detectDaemonMode(
  hello: unknown,
  request: Request,
): Promise<DaemonMode | null> {
  const reported = reportedDaemonMode(hello);
  if (reported) return reported;
  try {
    await request(PROBE_METHOD, PROBE_PARAMS, { timeoutMs: PROBE_TIMEOUT_MS });
    return 'regular';
  } catch (error) {
    if (!record(error) && !(error instanceof Error)) return null;
    const rpcCode = (error as { rpcCode?: unknown }).rpcCode;
    // No daemon answer yet: a transport failure, or a daemon still starting.
    if (typeof rpcCode !== 'number' || classifyStartupReply(error)) return null;
    const data = (error as { data?: unknown }).data;
    return rpcCode === -32003 && record(data) && data.code === 'node-mode' ? 'node' : 'regular';
  }
}

/**
 * Classifier for the daemon's "agent not found" rejection from `agent.get`
 * (JSON-RPC `-32602` with a "not found" message, PROTOCOL §5.5).
 *
 * A stale panel tab / route / speculative surface referencing a deleted agent
 * is an EXPECTED condition, not an error: callers log it at WARN and clean up
 * (close the stale tab, navigate home) instead of surfacing an ERROR
 * (monorepo#1753). Genuine transport failures do not match and stay ERROR.
 *
 * Structural check (rpcCode/code + message) rather than `instanceof
 * BackendError`, mirroring `isMethodNotFoundError` in
 * `$features/agent/main/agent-missing.ipc.ts`, so serialized or re-wrapped
 * copies of the error classify the same way.
 */
const NOT_FOUND_RPC_CODE = -32602;

export function isAgentNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { message, rpcCode, code } = error as {
    message?: unknown;
    rpcCode?: unknown;
    code?: unknown;
  };
  if (typeof message !== 'string' || !/not found/i.test(message)) return false;
  return rpcCode === NOT_FOUND_RPC_CODE || code === 'INVALID_PARAMS';
}

/**
 * Classifier for the daemon's "agent not found" rejection from `agent.get`
 * (JSON-RPC `-32602` with a "not found" message, PROTOCOL §5.5).
 *
 * A stale panel tab / route / speculative surface referencing a deleted agent
 * is an EXPECTED condition, not an error: callers log it at WARN and clean up
 * (close the stale tab, navigate home) instead of surfacing an ERROR
 * (monorepo#1753). Genuine transport failures do not match and stay ERROR.
 *
 * Structural check rather than `instanceof BackendError`, mirroring
 * `isMethodNotFoundError` in `$features/agent/main/agent-missing.ipc.ts`, so
 * serialized or re-wrapped copies of the error classify the same way. The
 * daemon attaches the machine-readable discriminator `data.code: "not-found"`
 * (monorepo#1320), which both live transports prefer when resolving the
 * string `code` — that structured field is checked first; the
 * `rpcCode` + message pair is kept as a fallback for errors that lost the
 * structured code (e.g. older daemons or lossy re-wrapping).
 */
const NOT_FOUND_RPC_CODE = -32602;
const NOT_FOUND_CODE = 'not-found';

export function isAgentNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { message, rpcCode, code, data } = error as {
    message?: unknown;
    rpcCode?: unknown;
    code?: unknown;
    data?: unknown;
  };
  const dataCode = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
  if (code === NOT_FOUND_CODE || dataCode === NOT_FOUND_CODE) return true;
  return (
    rpcCode === NOT_FOUND_RPC_CODE && typeof message === 'string' && /not found/i.test(message)
  );
}

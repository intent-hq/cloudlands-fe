/** The daemon currently reports filesystem ENOENT as an internal RPC error.
 * Do not classify unknown roots, containment or support errors as deleted files. */
export function isMissingWorkingTreeFile(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { rpcCode, message, data } = error as {
    rpcCode?: unknown;
    message?: unknown;
    data?: { detail?: unknown };
  };
  if (rpcCode !== -32603) return false;
  const detail = typeof data?.detail === 'string' ? data.detail : message;
  return typeof detail === 'string' && /\(os error 2\)$/.test(detail);
}

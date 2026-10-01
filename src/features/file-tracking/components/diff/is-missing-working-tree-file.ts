/** The daemon currently reports filesystem ENOENT as an internal RPC error.
 * Do not classify unknown roots, containment or support errors as deleted files. */
export function isMissingWorkingTreeFile(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { rpcCode, message } = error as { rpcCode?: unknown; message?: unknown };
  return rpcCode === -32603 && typeof message === 'string' && /\(os error 2\)$/.test(message);
}

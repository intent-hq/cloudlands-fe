import { m } from './paraglide/messages.js';

/** Require the registered-root file.read/file.readChunk contract; unknown generations fail closed. */
function assertRootFileSupport(protocolVersion: unknown): void {
  const match =
    typeof protocolVersion === 'string' ? protocolVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?$/) : null;
  // Protocol 12 removes unrelated RPCs and retains the registered-root read contract.
  const supported =
    match && ((Number(match[1]) === 11 && Number(match[2]) >= 1) || Number(match[1]) === 12);
  if (!supported) {
    throw new Error(m.files_secondaryRoot_unsupported_error());
  }
}

/** Invoke synchronously at the socket write, using only that socket's hello result. */
export function assertScopedFileReadSupport(
  method: string,
  params: unknown,
  protocolVersion: unknown,
): void {
  if (isScopedFileRead(method, params)) assertRootFileSupport(protocolVersion);
}

export function isScopedFileRead(method: string, params: unknown): boolean {
  if (method !== 'file.read' && method !== 'file.readChunk') return false;
  const root = (params as { gitRootId?: unknown } | null)?.gitRootId;
  return typeof root === 'string' && !!root.trim();
}

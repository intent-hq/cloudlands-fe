import { m } from './paraglide/messages.js';

/** Registered-root reads were added in protocol 11.1; unknown generations fail closed. */
function assertRootFileSupport(protocolVersion: unknown): void {
  const match =
    typeof protocolVersion === 'string' ? protocolVersion.match(/^(\d+)\.(\d+)(?:\.\d+)?$/) : null;
  if (!match || Number(match[1]) !== 11 || Number(match[2]) < 1) {
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

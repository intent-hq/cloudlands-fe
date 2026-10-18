import { protocolVersionAtLeast, type ProtocolVersion } from './protocol-version';
import { m } from './paraglide/messages.js';

/**
 * Require the registered-root file.read/file.readChunk contract (the release that
 * added `gitRootId`, or newer). Missing, malformed and older versions fail closed;
 * there is no upper bound — clients never cap the protocol version
 * (intent-hq/intent#7206).
 */
function assertRootFileSupport(protocolVersion: ProtocolVersion | null | undefined): void {
  if (!protocolVersionAtLeast(protocolVersion, 11, 1)) {
    throw new Error(m.files_secondaryRoot_unsupported_error());
  }
}

/** Invoke synchronously at the socket write, using only that socket's hello result. */
export function assertScopedFileReadSupport(
  method: string,
  params: unknown,
  protocolVersion: ProtocolVersion | null | undefined,
): void {
  if (isScopedFileRead(method, params)) assertRootFileSupport(protocolVersion);
}

export function isScopedFileRead(method: string, params: unknown): boolean {
  if (method !== 'file.read' && method !== 'file.readChunk') return false;
  const root = (params as { gitRootId?: unknown } | null)?.gitRootId;
  return typeof root === 'string' && !!root.trim();
}

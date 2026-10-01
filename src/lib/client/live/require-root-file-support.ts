import { backendRequest } from './backend-transport';
import { m } from '$shared/paraglide/messages.js';

/** Probe the current backend; never cache support across reconnects or backend switches. */
export async function requireRootFileSupport(): Promise<void> {
  const hello = await backendRequest<{ protocolVersion?: string }>('client.hello', {});
  const match = hello?.protocolVersion?.match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
  // The additive registered-root file.read/file.readChunk contract.
  if (!match || Number(match[1]) !== 11 || Number(match[2]) < 1) {
    throw new Error(m.files_secondaryRoot_unsupported_error());
  }
}

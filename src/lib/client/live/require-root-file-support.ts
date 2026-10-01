import { backendRequest } from './backend-transport';
import { assertRootFileSupport } from '$shared/root-file-read-support';

/** Probe the current backend; never cache support across reconnects or backend switches. */
export async function requireRootFileSupport(): Promise<void> {
  const hello = await backendRequest<{ protocolVersion?: string }>('client.hello', {});
  assertRootFileSupport(hello?.protocolVersion);
}

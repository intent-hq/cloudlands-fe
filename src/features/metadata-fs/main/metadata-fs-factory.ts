/**
 * MetadataFS Factory
 *
 * Returns the `LocalMetadataFS` implementation for a workspace. Remote
 * workspaces are no longer supported (the remote RPC stack retired in P3-5).
 * Instances are cached per workspace ID so repeated calls are cheap.
 */

import type { IMetadataFS } from './metadata-fs';
import { LocalMetadataFS } from './local-metadata-fs';

/** Cache of IMetadataFS instances keyed by workspace ID. */
const instanceCache = new Map<string, IMetadataFS>();

/**
 * Get (or create) an `IMetadataFS` for the given workspace.
 */
export function getMetadataFS(workspaceId: string): IMetadataFS {
  const cached = instanceCache.get(workspaceId);
  if (cached) {
    return cached;
  }

  const instance = new LocalMetadataFS();
  instanceCache.set(workspaceId, instance);
  return instance;
}

/**
 * Clear the instance cache. Primarily useful for tests.
 */
export function clearMetadataFSCache(): void {
  instanceCache.clear();
}

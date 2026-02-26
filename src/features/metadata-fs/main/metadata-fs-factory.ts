/**
 * MetadataFS Factory
 *
 * Returns the correct `IMetadataFS` implementation for a workspace:
 * - `LocalMetadataFS`  for local workspaces
 * - `RemoteMetadataFS` for SSH / remote workspaces
 *
 * Reads `workspace.json` (which always lives locally) to determine whether
 * the workspace is remote, following the same pattern as
 * `GitService.isRemoteWorkspace`.
 *
 * Instances are cached per workspace ID so repeated calls are cheap.
 */

import * as fs from 'fs';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import type { IMetadataFS } from './metadata-fs';
import { LocalMetadataFS } from './local-metadata-fs';
import { CachedRemoteMetadataFS } from './cached-remote-metadata-fs';

const logger = new Logger('MetadataFSFactory');

/** Cache of IMetadataFS instances keyed by workspace ID. */
const instanceCache = new Map<string, IMetadataFS>();

/**
 * Get (or create) an `IMetadataFS` for the given workspace.
 *
 * The workspace's `workspace.json` is read **synchronously** from the local
 * filesystem to decide remote vs. local.  This mirrors the existing pattern
 * used by `GitService.isRemoteWorkspace`.
 */
export function getMetadataFS(workspaceId: string): IMetadataFS {
  const cached = instanceCache.get(workspaceId);
  if (cached) {
    return cached;
  }

  const isRemote = isRemoteWorkspace(workspaceId);
  let instance: IMetadataFS;
  if (isRemote) {
    const localBasePath = WorkspaceConfig.paths.metadata(workspaceId);
    const remoteBasePath = `~/intent/workspaces/${workspaceId}/.workspace`;
    instance = new CachedRemoteMetadataFS({ workspaceId, localBasePath, remoteBasePath });
  } else {
    instance = new LocalMetadataFS();
  }

  logger.info('Created MetadataFS instance', { workspaceId, type: isRemote ? 'remote' : 'local' });
  instanceCache.set(workspaceId, instance);
  return instance;
}

/**
 * Check whether a workspace is remote by reading its local `workspace.json`.
 *
 * Returns `false` if the file is missing or unreadable (safe default).
 */
function isRemoteWorkspace(workspaceId: string): boolean {
  try {
    const workspaceJsonPath = WorkspaceConfig.paths.workspaceMetadata(workspaceId);
    if (fs.existsSync(workspaceJsonPath)) {
      const workspaceData = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
      return workspaceData.isRemote === true;
    }
  } catch (error) {
    logger.debug('Error checking if workspace is remote', { workspaceId, error });
  }
  return false;
}

/**
 * Clear the instance cache.  Primarily useful for tests.
 */
export function clearMetadataFSCache(): void {
  instanceCache.clear();
}


import { store } from '@/store';
import { workspaceClient } from './workspace-client';
import * as deletions from './workspace-deletion';
import { createWorkspaceDomainClientRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-factory';
import type {
  WorkspaceDomainClient,
  WorkspaceDomainReadTransport,
} from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-types';

/**
 * Bind the canonical domain client to the current React Store and wire client.
 * The host must supply real list/open/diff/git/task handlers before integration;
 * generated IPC is not a production read transport in this renderer.
 * Retain one client per consuming lifetime to share its cache/deduplication.
 * Deletion tokens come from this renderer's workspace-deletion binding.
 * Existing root startup owns Store and authority hydration; this creates neither.
 */
export function createReactWorkspaceDomainClient(
  transport: WorkspaceDomainReadTransport,
): WorkspaceDomainClient {
  const WorkspaceClient = createWorkspaceDomainClientRuntime({
    store,
    workspaces: workspaceClient,
    deletions,
    transport,
  });
  return new WorkspaceClient();
}

export type {
  WorkspaceDomainClient,
  WorkspaceDomainReadTransport,
} from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-types';

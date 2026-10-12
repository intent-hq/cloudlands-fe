import { store } from '../../../store';
import { appClient } from '$lib/client';
import { invoke as invokeIpc } from '$shared/generated/ipc-client';
import * as deletions from './workspace-deletion';
import { createWorkspaceDomainClientRuntime } from './workspace-domain-client-factory';

/** Compatibility facade for existing callers until the Svelte renderer retires. */
export const WorkspaceClient = createWorkspaceDomainClientRuntime({
  store,
  workspaces: appClient.workspaces,
  deletions,
  transport: {
    available: () => typeof window !== 'undefined' && !!window.electronAPI,
    invoke: invokeIpc,
  },
});
export type WorkspaceClient = InstanceType<typeof WorkspaceClient>;
export const workspaceClient = new WorkspaceClient();

import * as backend from './backend-transport';
import { createWorkspaceClientRuntime } from './backend-workspace-client';

/** Compatibility facade for existing callers until the Svelte renderer retires. */
export const LiveWorkspacesClient = createWorkspaceClientRuntime(backend);
export type LiveWorkspacesClient = InstanceType<typeof LiveWorkspacesClient>;

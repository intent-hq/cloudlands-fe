import { backend } from '@/features/backend/backend-transport';
import { createWorkspaceClientRuntime } from '$lib/client/live/backend-workspace-client';
import type { WorkspacesClient } from '$lib/client/workspaces-client-types';

const WorkspaceClient = createWorkspaceClientRuntime(backend);

/**
 * Shared lower-level wire client. Views must use the canonical workspace
 * mutation admission owner once integrated; this client grants no authority.
 * The consuming lifetime owns subscriptions and captured resource releases.
 */
export const workspaceClient: WorkspacesClient = new WorkspaceClient();

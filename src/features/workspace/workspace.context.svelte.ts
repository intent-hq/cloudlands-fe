/**
 * Workspace Context
 *
 * Provides workspace information to child components using Svelte 5 context API.
 */

import { getContext, setContext } from 'svelte';
import type { Workspace } from '$shared/types';
import { workspaceStore } from '$features/workspace/workspace.store.svelte';

const WORKSPACE_CONTEXT_KEY = Symbol('workspace');

export interface WorkspaceContextValue {
  workspace: Workspace | null;
  workspaceId: string | null;
  deleteWorkspace: () => Promise<void>;
  drawerOpen?: boolean;
  drawerType?: string;
  drawerContent?: any;
  closeDrawer?: () => void;
  openDrawer?: (type: string, content?: any) => void;
  openAgentChat?: (agentType?: string) => void;
}

/**
 * Set workspace context for child components
 */
export function setWorkspaceContext(workspace: Workspace | null): WorkspaceContextValue {
  const context: WorkspaceContextValue = {
    workspace,
    workspaceId: workspace?.id || null,
    deleteWorkspace: async () => {
      if (workspace?.id) {
        await workspaceStore.deleteWithUndo(workspace.id, workspace.title);
      }
    },
  };

  setContext(WORKSPACE_CONTEXT_KEY, context);
  return context;
}

/**
 * Get workspace context from parent component
 */
export function getWorkspaceContext(): WorkspaceContextValue {
  return (
    getContext(WORKSPACE_CONTEXT_KEY) || {
      workspace: null,
      workspaceId: null,
      deleteWorkspace: async () => {},
    }
  );
}

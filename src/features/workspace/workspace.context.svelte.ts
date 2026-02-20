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
        const { toast } = await import('svelte-sonner');
        const workspaceTitle = workspace.title;
        const workspaceId = workspace.id;

        // Remove from UI immediately for responsive feedback
        workspaceStore.removeFromUI(workspaceId);

        let undoClicked = false;
        const toastId = toast.warning(
          workspaceTitle ? `Deleted "${workspaceTitle}"` : 'Workspace deleted',
          {
            duration: 15000,
            action: {
              label: 'Undo',
              onClick: async () => {
                undoClicked = true;
                // Clear the pending deletion flag so load() can restore it
                workspaceStore.restoreToUI(workspaceId);
                await workspaceStore.load();
                toast.dismiss(toastId);
              },
            },
          },
        );

        // After 15 seconds, actually delete from disk if not undone
        setTimeout(async () => {
          if (!undoClicked) {
            // Pass skipOptimisticRemoval=true since we already removed from UI
            const result = await workspaceStore.delete(workspaceId, true);
            if (!result.ok) {
              await workspaceStore.load();
              toast.error('Failed to delete workspace');
            }
          }
        }, 15000);
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

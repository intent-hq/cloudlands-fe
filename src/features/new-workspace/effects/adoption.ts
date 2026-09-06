import type { AppClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { bootstrapNewWorkspaceLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { clearWorkspaceCreateProgress } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
import {
  createWorkspaceNavigationState,
  hydrateWorkspaceNavigation,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { batchRendererActions, type ReduxAction } from '$store/renderer/batch-actions';

type Workspace = NonNullable<Awaited<ReturnType<AppClient['workspaces']['get']>>>;
type Agent = NonNullable<Awaited<ReturnType<AppClient['agents']['get']>>>;
interface WorkspaceAdoptionInput {
  workspace: Workspace;
  initialAgent: Agent | null;
  operationKey?: string;
}

export type WorkspaceAdoption = (input: WorkspaceAdoptionInput) => void | Promise<void>;

export interface WorkspaceAdoptionDependencies {
  dispatch?: (action: ReduxAction) => void;
}

/** Build the real, injectable workspace adoption transaction used by the route host. */
export function createWorkspaceAdoption(
  dependencies: WorkspaceAdoptionDependencies = {},
): WorkspaceAdoption {
  const dispatch = dependencies.dispatch ?? ((action: ReduxAction) => appStore.dispatch(action));

  return ({ workspace, initialAgent, operationKey }) => {
    const agentId = initialAgent?.id ?? null;
    const actions: ReduxAction[] = [
      setWorkspaceEntity(workspace),
      setInitialAgentId(workspace.id, agentId),
      ...(initialAgent ? [bulkUpsertSessions([initialAgent])] : []),
      bootstrapNewWorkspaceLayout(
        workspace.id,
        agentId,
        initialAgent?.name ?? '',
        true,
        undefined,
        workspace.contextLinks,
      ),
      hydrateWorkspaceNavigation(
        workspace.id,
        createWorkspaceNavigationState(workspace.id, {
          mainPanel: { type: 'empty' },
          ui: { hasInitialized: false },
        }),
      ),
      openWorkspaceTab(workspace.id),
      ...(operationKey ? [clearWorkspaceCreateProgress(operationKey)] : []),
    ];
    dispatch(batchRendererActions(actions));
  };
}

export const adoptPromotedWorkspace = createWorkspaceAdoption();

import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  initialState as sidebarNavInitialState,
  sidebarNavReducer,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '$store/renderer/slices/workspace/workspace-slice';
import { withLegacyPrincipal } from './principal-state';

export function labelWorkspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: id as WorkspaceId,
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Workspace;
}

/**
 * Admitted owner state with a loaded workspace list, local pins, and the
 * `workspaceLabels: 1` capability unless `supported` is false, plus
 * `workspaceAutoArchiveOptOut: 1` when `autoArchiveOptOut` is set. Idle
 * auto-archive is on (`autoArchiveIdleAfterDays`, default 7; `0` is off).
 */
export function workspaceLabelsState({
  workspaces = [],
  pinned = [],
  supported = true,
  role = 'owner',
  autoArchiveOptOut = false,
  autoArchiveIdleAfterDays = 7,
}: {
  workspaces?: Workspace[];
  pinned?: string[];
  supported?: boolean;
  role?: 'owner' | 'guest';
  autoArchiveOptOut?: boolean;
  autoArchiveIdleAfterDays?: number | null;
} = {}): StoreState {
  const workspace = workspaces.reduce(
    (state, row) => workspaceReducer(state, setWorkspaceEntity(row)),
    workspaceInitialState,
  );
  const admitted = withLegacyPrincipal(
    {
      workspace,
      sidebarNav: {
        ...sidebarNavInitialState,
        pinnedWorkspaceIds: pinned,
        autoArchiveIdleAfterDays,
      },
    },
    role,
  );
  const snapshot = admitted.principal.snapshot!;
  const state = {
    ...admitted,
    principal: {
      ...admitted.principal,
      snapshot: {
        ...snapshot,
        capabilities: {
          ...snapshot.capabilities,
          ...(supported ? { workspaceLabels: 1 as const } : {}),
          ...(autoArchiveOptOut ? { workspaceAutoArchiveOptOut: 1 as const } : {}),
        },
      },
    },
  } as StoreState;
  return {
    ...state,
    workspace: {
      ...state.workspace,
      hasLoaded: true,
      loadedBackendId: state.connections.windowBackendId,
      capabilityContext: selectPrincipalActionContext.select(state),
    },
  };
}

/** Apply an action to the slices the label sagas read and write. */
export function reduceWorkspaceLabelsState(
  state: StoreState,
  action: { type: string },
): StoreState {
  return {
    ...state,
    workspace: workspaceReducer(state.workspace, action as never),
    sidebarNav: sidebarNavReducer(state.sidebarNav, action as never),
  };
}

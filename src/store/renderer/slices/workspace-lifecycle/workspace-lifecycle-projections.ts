import type { StoreSelectorSelect } from '@themislib/themis/types';
import type {
  WorkspaceLifecycleState,
  WorkspaceLoadState,
  WorkspaceSessionPhase,
} from './workspace-lifecycle-types';
/** Existing mounted lifetime: hydration completed or the workspace is live. */
export const getMountedWorkspaceIds = (state: {
  workspaceLifecycle: WorkspaceLifecycleState;
}): string[] => {
  const phases: Record<string, WorkspaceSessionPhase> =
    state.workspaceLifecycle.sessionPhaseByWorkspaceId;
  return Object.keys(phases).filter(
    (wsId) => phases[wsId] === 'hydrated' || phases[wsId] === 'live',
  );
};

export const getWorkspaceSessionPhase = (
  state: { workspaceLifecycle: WorkspaceLifecycleState },
  wsId: string,
) => state.workspaceLifecycle.sessionPhaseByWorkspaceId[wsId];

/** Keep the private phase selector's composition and unknown result in each renderer. */
export function createIsWorkspaceSessionLiveProjection<State>(selectWorkspaceSessionPhase: {
  select: StoreSelectorSelect<unknown, [wsId: string], State>;
}) {
  return (state: State, wsId: string) => selectWorkspaceSessionPhase.select(state, wsId) === 'live';
}

/** Preserve hydration composition through each renderer's private phase selector. */
export function createIsWorkspaceHydratedProjection<State>(selectWorkspaceSessionPhase: {
  select: StoreSelectorSelect<unknown, [wsId: string], State>;
}) {
  return (state: State, wsId: string) => {
    const phase = selectWorkspaceSessionPhase.select(state, wsId);
    return phase === 'hydrated' || phase === 'live';
  };
}

const INITIAL_WORKSPACE_LOAD_STATE: WorkspaceLoadState = {
  status: 'idle',
  error: null,
};

export const getWorkspaceLoadState = (
  state: { workspaceLifecycle: WorkspaceLifecycleState },
  wsId: string,
): WorkspaceLoadState =>
  state.workspaceLifecycle.loadByWorkspaceId[wsId] ?? INITIAL_WORKSPACE_LOAD_STATE;

import type { WorkspaceLifecycleState, WorkspaceSessionPhase } from './workspace-lifecycle-types';
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

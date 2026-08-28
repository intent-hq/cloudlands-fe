export type WorkspaceSessionPhase = 'hydrated' | 'opened' | 'live';

export interface WorkspaceLifecycleState {
  sessionPhaseByWorkspaceId: Record<string, WorkspaceSessionPhase>;
}

export type WorkspaceSessionPhase = 'hydrated' | 'opened' | 'live';

export type WorkspaceLoadStatus =
  'idle' | 'loading' | 'cached-ready' | 'optimistic' | 'ready' | 'not-found' | 'error';

export interface WorkspaceLoadError {
  kind: 'not_found' | 'error';
  message: string;
}

export interface WorkspaceLoadState {
  status: WorkspaceLoadStatus;
  error: WorkspaceLoadError | null;
}

export interface WorkspaceLifecycleState {
  sessionPhaseByWorkspaceId: Record<string, WorkspaceSessionPhase>;
  loadByWorkspaceId: Record<string, WorkspaceLoadState>;
}

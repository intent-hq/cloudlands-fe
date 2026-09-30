export type PRWorkflowCommand =
  | { kind: 'commit'; commitMessage: string }
  | {
      kind: 'create-pr';
      prTitle: string;
      prDescription: string;
      targetBranch?: string;
      hasStaged?: boolean;
      requireAuth?: boolean;
    }
  | { kind: 'prepare-pr'; createAfter?: boolean }
  | { kind: 'push'; targetBranch?: string; upToCommitHash: string }
  | { kind: 'pull' }
  | { kind: 'force-push' }
  | { kind: 'refresh-pr'; requireAuth?: boolean }
  | { kind: 'rebase'; trunkBranch: string }
  | { kind: 'connect-remote'; remoteUrl: string }
  | { kind: 'rebase-terminal'; targetBranch: string }
  | { kind: 'refresh' };

export interface PRWorkflowResult {
  success: boolean;
  error?: string;
  needsAuth?: boolean;
  prNumber?: number;
  prHtmlUrl?: string;
}

interface PRWorkflowOperation {
  requestId: string;
  status: 'pending' | 'success' | 'error' | 'auth-required';
  result: PRWorkflowResult | null;
}

export interface PRWorkflowWorkspaceState {
  operations: Partial<Record<PRWorkflowCommand['kind'], PRWorkflowOperation>>;
  pendingAuth: PRWorkflowCommand | null;
  prDrawerOpen: boolean;
  forcePushDrawerOpen: boolean;
  connectRemoteDrawerOpen: boolean;
  commitDrawerOpen: boolean;
}

export interface PRWorkflowState {
  byWorkspaceId: Record<string, PRWorkflowWorkspaceState>;
}

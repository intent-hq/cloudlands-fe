import { track } from './client';
import type { GitOpTrigger } from './types';

export type GitOp = 'commit' | 'push' | 'create-pr' | 'merge' | 'merge-pr' | 'undo-commit' | 'undo-push';

const validGitOps = new Set<string>(['commit', 'push', 'create-pr', 'merge', 'merge-pr', 'undo-commit', 'undo-push']);

export function isGitOp(op: string): op is GitOp {
  return validGitOps.has(op);
}

const opToEventName: Record<GitOp, string> = {
  'commit': 'Committed Changes',
  'push': 'Pushed Changes',
  'create-pr': 'Created Pull Request',
  'merge': 'Merged Changes',
  'merge-pr': 'Merged Pull Request on GitHub',
  'undo-commit': 'Undid Commit',
  'undo-push': 'Undid Push',
};

interface TrackGitOpParams {
  workspaceId: string;
  success: boolean;
  trigger: GitOpTrigger;
  agentId?: string;
  /** For Pushed Changes */
  commitCount?: number;
  /** For Pushed Changes */
  hasPr?: boolean;
  /** For Merged Pull Request on GitHub */
  prNumber?: number;
  /** For Merged Pull Request on GitHub */
  mergeMethod?: string;
  /** For Undid Commit */
  commitCountUndone?: number;
}

export function trackGitOp(op: GitOp, params: TrackGitOpParams): void {
  const { workspaceId, success, trigger, agentId } = params;
  const baseProps: Record<string, unknown> = {
    workspace_id: workspaceId,
    success,
    trigger,
  };
  if (agentId) {
    baseProps.agent_id = agentId;
  }

  switch (op) {
    case 'push':
      track('Pushed Changes', {
        ...baseProps,
        ...(params.commitCount != null && { commit_count: params.commitCount }),
        ...(params.hasPr != null && { has_pr: params.hasPr }),
      } as any);
      break;
    case 'merge-pr':
      track('Merged Pull Request on GitHub', {
        ...baseProps,
        ...(params.prNumber != null && { pr_number: params.prNumber }),
        ...(params.mergeMethod != null && { merge_method: params.mergeMethod }),
      } as any);
      break;
    case 'undo-commit':
      track('Undid Commit', {
        ...baseProps,
        ...(params.commitCountUndone != null && { commit_count: params.commitCountUndone }),
      } as any);
      break;
    default: {
      const eventName = opToEventName[op];
      if (!eventName) {
        console.warn(`[analytics] Unknown git operation: ${op}`);
        return;
      }
      track(eventName as any, baseProps as any);
      break;
    }
  }
}


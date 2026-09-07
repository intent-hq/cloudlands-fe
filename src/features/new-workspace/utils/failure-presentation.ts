import type { FailedState } from '../controller';

export type FailureStage = 'restore' | 'create' | 'setup' | 'send';
export type FailureStepStatus = 'pending' | 'done' | 'error';

export interface FailurePresentation {
  stage: FailureStage;
  repoStatus: FailureStepStatus;
  branchStatus: FailureStepStatus;
  agentStatus: FailureStepStatus;
}

export function getFailurePresentation(failure: FailedState): FailurePresentation {
  const retryPhase = failure.retryState?.phase;
  const workspaceCreated =
    retryPhase === 'adopting' || retryPhase === 'placingAttachments' || retryPhase === 'sending';

  if (failure.kind === 'send') {
    return { stage: 'send', repoStatus: 'done', branchStatus: 'done', agentStatus: 'error' };
  }
  if (failure.kind === 'adopt' || failure.kind === 'attachments' || workspaceCreated) {
    return { stage: 'setup', repoStatus: 'done', branchStatus: 'done', agentStatus: 'error' };
  }
  if (failure.kind === 'restore' || failure.kind === 'draft' || failure.kind === 'deleted') {
    return {
      stage: 'restore',
      repoStatus: 'error',
      branchStatus: 'pending',
      agentStatus: 'pending',
    };
  }
  return { stage: 'create', repoStatus: 'error', branchStatus: 'pending', agentStatus: 'pending' };
}

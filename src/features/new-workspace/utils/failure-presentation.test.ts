import { describe, expect, it } from 'vitest';
import { createInitialControllerState, reduce, type FailedState } from '../controller';
import { getFailurePresentation } from './failure-presentation';

function failure(kind: FailedState['kind'], retryPhase: 'restoring' | 'sending'): FailedState {
  let state = createInitialControllerState(0);
  state = reduce(state, { type: 'backend.connected', generation: 0, draftId: 'draft-1' });
  if (retryPhase === 'sending') {
    return {
      ...state,
      phase: 'failed',
      kind,
      error: 'failed',
      workspaceId: 'workspace-1',
      retryState: {
        ...state,
        phase: 'sending',
        workspaceId: 'workspace-1',
        deliveryStage: 'issued',
      },
    };
  }
  return {
    ...state,
    phase: 'failed',
    kind,
    error: 'failed',
    retryState: { ...state, phase: 'restoring' },
  };
}

describe('new-workspace failure presentation', () => {
  it('marks restore as the failed first stage without inventing completed work', () => {
    expect(getFailurePresentation(failure('restore', 'restoring'))).toEqual({
      stage: 'restore',
      repoStatus: 'error',
      branchStatus: 'pending',
      agentStatus: 'pending',
    });
  });

  it('preserves workspace creation history when first-message delivery fails', () => {
    expect(getFailurePresentation(failure('send', 'sending'))).toEqual({
      stage: 'send',
      repoStatus: 'done',
      branchStatus: 'done',
      agentStatus: 'error',
    });
  });
});

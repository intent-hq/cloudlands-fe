import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  pendingSubmissionsReducer,
  pendingScopeActivated,
  pendingSubmissionAccepted,
  pendingEvidenceObserved,
} from '../pending-submissions-slice';
import { pendingRetentionSaga } from './pending-retention-saga';

describe('pending correlation expiry', () => {
  it('expires idle terminal evidence after ten minutes while retaining unresolved callback guards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scope = {
      agentId: 'agent',
      workspaceId: 'workspace',
      principalId: 'alice',
      authority: 'host',
      participation: 'epoch',
      owner: 'owner',
    };
    let state = pendingSubmissionsReducer(undefined, pendingScopeActivated(scope, 1));
    state = pendingSubmissionsReducer(
      state,
      pendingSubmissionAccepted(scope, {
        id: 'a',
        content: 'A',
        destination: 'queue',
        createdAt: 0,
      }),
    );
    const channel = stdChannel();
    const dispatch = (action: { type: string }) => {
      state = pendingSubmissionsReducer(state, action);
      channel.put(action);
    };
    const task = runSaga(
      { channel, dispatch, getState: () => ({ pendingSubmissions: state }) },
      pendingRetentionSaga,
    );
    try {
      dispatch(
        pendingEvidenceObserved(
          scope,
          'history',
          [
            {
              author: { principalId: 'alice', login: null, displayName: null, avatarUrl: null },
              submissionIds: ['a'],
            },
          ],
          0,
        ),
      );
      expect(getItems(state.byAgentId.agent.tombstones)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(600000);
      expect(getItems(state.byAgentId.agent.tombstones)).toEqual([]);
      expect(getItems(state.byAgentId.agent.operations).map((s) => [s.id, s.observed])).toEqual([
        ['a', true],
      ]);
    } finally {
      task.cancel();
      vi.useRealTimers();
    }
  });
});

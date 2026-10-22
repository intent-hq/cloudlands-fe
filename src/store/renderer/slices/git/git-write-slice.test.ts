import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  cancelQueuedGitWrite,
  gitWriteConsumerReleased,
  gitWriteFinished,
  gitWriteReducer,
  gitWriteRequested,
  gitWriteStarted,
} from './git-write-slice';
import {
  selectGitGroupCommits,
  selectGitWriteOperation,
  selectGitWritePending,
} from './git-write-selectors';
import type { GitWriteOperation } from './git-write-types';

const operation: GitWriteOperation = { kind: 'stage', paths: ['a.ts'], consumerId: 'panel' };

describe('Git write state', () => {
  it('starts empty, records queued/running/outcome facts and derives pending', () => {
    const initial = gitWriteReducer(undefined, { type: 'test/init' });
    expect(initial).toEqual({ byWorkspaceId: {} });
    expect(gitWriteReducer(initial, { type: 'unrelated' })).toBe(initial);
    const request = gitWriteRequested('a', 'one', operation);
    let state = gitWriteReducer(initial, request);
    expect(gitWriteReducer(state, request)).toBe(state);
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'a')).toBe(true);
    state = gitWriteReducer(state, gitWriteStarted('a', 'one'));
    expect(gitWriteReducer(state, gitWriteStarted('a', 'one'))).toBe(state);
    expect(gitWriteReducer(state, cancelQueuedGitWrite('a', 'one'))).toBe(state);
    state = gitWriteReducer(state, gitWriteFinished('a', 'one', { success: true }, operation));
    expect(selectGitWriteOperation.select({ gitWrite: state } as never, 'a', 'one')?.status).toBe(
      'succeeded',
    );
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'a')).toBe(false);
    expect(
      gitWriteReducer(state, gitWriteFinished('a', 'one', { success: false }, operation)),
    ).toBe(state);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('cancels only queued requests and preserves workspace isolation', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'one', operation));
    state = gitWriteReducer(state, gitWriteRequested('b', 'one', operation));
    state = gitWriteReducer(state, cancelQueuedGitWrite('a', 'one'));
    expect(selectGitWriteOperation.select({ gitWrite: state } as never, 'a', 'one')?.status).toBe(
      'cancelled',
    );
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'b')).toBe(true);
    expect(gitWriteReducer(state, cancelQueuedGitWrite('a', 'one'))).toBe(state);
    state = gitWriteReducer(state, workspaceUnmounted('a'));
    expect(gitWriteReducer(state, gitWriteFinished('a', 'one', { success: true }, operation))).toBe(
      state,
    );
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'b')).toBe(true);
  });

  it('clears released consumer outcomes, ignores late results, and exposes group queue', () => {
    const group: GitWriteOperation = {
      kind: 'partialCommit',
      paths: ['b.ts'],
      section: 'unstaged',
      message: 'group',
      groupKey: 'manual',
    };
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'one', operation));
    state = gitWriteReducer(state, gitWriteRequested('a', 'group', group));
    state = gitWriteReducer(
      state,
      gitWriteFinished('a', 'one', { success: false, error: 'failed' }, operation),
    );
    expect(
      selectGitWriteOperation.select({ gitWrite: state } as never, 'a', 'one')?.result,
    ).toEqual({ success: false, error: 'failed' });
    expect(
      selectGitGroupCommits.select({ gitWrite: state } as never, 'a').map((entry) => entry.id),
    ).toEqual(['group']);
    state = gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'));
    expect(getItems(state.byWorkspaceId.a.operations).map((entry) => entry.id)).toEqual(['group']);
    expect(gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'))).toBe(state);
    expect(gitWriteReducer(state, gitWriteFinished('a', 'one', { success: true }, operation))).toBe(
      state,
    );
  });
});

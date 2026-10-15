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
import { getGitCurrentIndexCommit } from './git-write-projections';

const operation: GitWriteOperation = { kind: 'stage', paths: ['a.ts'], consumerId: 'panel' };
const commit: GitWriteOperation = {
  kind: 'commit',
  params: { message: 'Checkpoint', userRequested: true, currentIndex: true },
  consumerId: 'panel',
};

describe('Git write state', () => {
  it('rejects repeated current-index commits while queued, running, or unknown', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'commit', commit));
    for (const status of ['queued', 'running', 'unknown'] as const) {
      if (status === 'running') state = gitWriteReducer(state, gitWriteStarted('a', 'commit'));
      if (status === 'unknown')
        state = gitWriteReducer(
          state,
          gitWriteFinished(
            'a',
            'commit',
            { success: false, commitOutcome: { state: 'unknown' } },
            commit,
          ),
        );
      expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')?.status).toBe(status);
      expect(gitWriteReducer(state, gitWriteRequested('a', 'duplicate', { ...commit }))).toBe(
        state,
      );
      expect(getGitCurrentIndexCommit({ gitWrite: state }, 'b')).toBeUndefined();
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('retains unknown outcomes across consumer departure, workspace unmount, and history eviction', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'commit', commit));
    state = gitWriteReducer(state, gitWriteStarted('a', 'commit'));
    state = gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'));
    state = gitWriteReducer(state, workspaceUnmounted('a'));
    state = gitWriteReducer(
      state,
      gitWriteFinished(
        'a',
        'commit',
        { success: false, commitOutcome: { state: 'unknown' } },
        commit,
      ),
    );
    expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')).toMatchObject({
      status: 'unknown',
      consumerReleased: true,
    });
    expect(gitWriteReducer(state, workspaceUnmounted('a'))).toBe(state);
    expect(gitWriteReducer(state, cancelQueuedGitWrite('a', 'commit'))).toBe(state);
    for (let index = 0; index < 40; index++) {
      state = gitWriteReducer(state, gitWriteRequested('a', `stage-${index}`, operation));
      state = gitWriteReducer(
        state,
        gitWriteFinished('a', `stage-${index}`, { success: true }, operation),
      );
    }
    expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')?.status).toBe('unknown');
    expect(gitWriteReducer(state, gitWriteRequested('a', 'duplicate', { ...commit }))).toBe(state);
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'a')).toBe(false);
  });

  it('permits a new explicit commit after a known refusal and exposes its confirmed receipt', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'first', commit));
    state = gitWriteReducer(
      state,
      gitWriteFinished('a', 'first', { success: false, error: 'Not dispatched' }, commit),
    );
    state = gitWriteReducer(state, gitWriteRequested('a', 'second', commit));
    const result = {
      success: true,
      commitOutcome: { state: 'confirmed' as const, hash: 'sha', files: ['a.ts'] },
    };
    state = gitWriteReducer(state, gitWriteFinished('a', 'second', result, commit));
    expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')).toMatchObject({
      id: 'second',
      status: 'succeeded',
      result,
    });
  });

  it('does not let retired authority cleanup delete a replacement request with the same id', () => {
    const replacement = { ...commit };
    const state = gitWriteReducer(undefined, gitWriteRequested('a', 'same', replacement));
    expect(
      gitWriteReducer(
        state,
        gitWriteFinished(
          'a',
          'same',
          { success: false, commitOutcome: { state: 'unknown' } },
          commit,
          true,
        ),
      ),
    ).toBe(state);
    const retired = gitWriteReducer(
      state,
      gitWriteFinished(
        'a',
        'same',
        { success: false, commitOutcome: { state: 'unknown' } },
        replacement,
        true,
      ),
    );
    expect(getGitCurrentIndexCommit({ gitWrite: retired }, 'a')).toMatchObject({
      status: 'unknown',
      result: { commitOutcome: { state: 'unknown' } },
    });
  });

  it.each(['confirmed', 'unknown'] as const)(
    'retains a retired %s receipt across departure and exposes it only to its initiating identity',
    (outcome) => {
      const operation = { ...commit, authorityKey: 'principal/root' };
      const result =
        outcome === 'confirmed'
          ? {
              success: true,
              commitOutcome: { state: outcome, hash: 'actual-sha', files: ['a.ts'] },
            }
          : { success: false, commitOutcome: { state: outcome } };
      let state = gitWriteReducer(undefined, gitWriteRequested('a', 'first', operation));
      state = gitWriteReducer(state, gitWriteStarted('a', 'first'));
      state = gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'));
      state = gitWriteReducer(state, gitWriteFinished('a', 'first', result, operation, true));
      state = gitWriteReducer(state, workspaceUnmounted('a'));
      expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a', 'principal/root')).toMatchObject({
        result,
      });
      expect(
        getGitCurrentIndexCommit({ gitWrite: state }, 'a', 'replacement/root'),
      ).toBeUndefined();
      expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')).toBeUndefined();
      expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a', null)).toBeUndefined();
      expect(gitWriteReducer(state, workspaceUnmounted('a'))).toBe(state);
      if (outcome === 'unknown') {
        expect(
          gitWriteReducer(
            state,
            gitWriteRequested('a', 'another', { ...operation, authorityKey: 'replacement/root' }),
          ),
        ).toBe(state);
      }
    },
  );

  it('retains an already-confirmed receipt when its consumer later departs', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'first', commit));
    const result = {
      success: true,
      commitOutcome: { state: 'confirmed' as const, hash: 'actual-sha', files: ['a.ts'] },
    };
    state = gitWriteReducer(state, gitWriteFinished('a', 'first', result, commit));
    state = gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'));
    state = gitWriteReducer(state, workspaceUnmounted('a'));
    expect(getGitCurrentIndexCommit({ gitWrite: state }, 'a')).toMatchObject({ result });
  });
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
  it('retains an admitted write across consumer and workspace retirement until settlement', () => {
    let state = gitWriteReducer(undefined, gitWriteRequested('a', 'one', operation));
    state = gitWriteReducer(state, gitWriteStarted('a', 'one'));
    state = gitWriteReducer(state, gitWriteConsumerReleased('a', 'panel'));
    state = gitWriteReducer(state, workspaceUnmounted('a'));
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'a')).toBe(true);
    expect(selectGitWriteOperation.select({ gitWrite: state } as never, 'a', 'one')).toMatchObject({
      status: 'running',
      consumerReleased: true,
    });
    state = gitWriteReducer(state, gitWriteFinished('a', 'one', { success: true }, operation));
    expect(selectGitWritePending.select({ gitWrite: state } as never, 'a')).toBe(false);
    expect(
      selectGitWriteOperation.select({ gitWrite: state } as never, 'a', 'one'),
    ).toBeUndefined();
  });
});

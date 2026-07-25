import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '$shared/types/branded-ids';
import {
  initialState,
  hydrateProposalLifecycle,
  pruneAppliedProposalLifecycleEntries,
  proposalApplyStarted,
  proposalApplySucceeded,
  proposalFailed,
  proposalLifecycleReducer,
  proposalUndoStarted,
  proposalUndoSucceeded,
} from './proposal-lifecycle-slice';

describe('proposalLifecycleReducer', () => {
  it('returns the initial state', () => {
    expect(proposalLifecycleReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('tracks apply start and success transitions', () => {
    const applying = proposalLifecycleReducer(
      initialState,
      proposalApplyStarted({ proposalId: 'p1', startedAt: 10 }),
    );
    expect(applying.p1).toEqual({ status: 'applying', startedAt: 10, lastAction: 'apply' });

    const applied = proposalLifecycleReducer(
      applying,
      proposalApplySucceeded({ proposalId: 'p1', completedAt: 20 }),
    );
    expect(applied.p1).toEqual({
      status: 'applied',
      startedAt: 10,
      completedAt: 20,
      lastAction: 'apply',
      error: undefined,
    });
  });

  it('tracks undo start and success transitions', () => {
    const applied = proposalLifecycleReducer(
      initialState,
      proposalApplySucceeded({ proposalId: 'p1', completedAt: 20 }),
    );
    const undoing = proposalLifecycleReducer(
      applied,
      proposalUndoStarted({ proposalId: 'p1', startedAt: 30 }),
    );
    expect(undoing.p1.status).toBe('undoing');
    expect(undoing.p1.lastAction).toBe('undo');

    const idle = proposalLifecycleReducer(
      undoing,
      proposalUndoSucceeded({ proposalId: 'p1', completedAt: 40 }),
    );
    expect(idle.p1.status).toBe('idle');
    expect(idle.p1.completedAt).toBe(40);
  });

  it('stores failed state with a retryable last action', () => {
    const failed = proposalLifecycleReducer(
      initialState,
      proposalFailed({
        proposalId: 'p1',
        error: 'Nope',
        completedAt: 50,
        lastAction: 'apply',
      }),
    );

    expect(failed.p1).toEqual({
      status: 'failed',
      error: 'Nope',
      completedAt: 50,
      lastAction: 'apply',
    });
    expect(failed.p1.errorCode).toBeUndefined();
  });

  it('stores the structured errorCode when proposalFailed carries one', () => {
    // The daemon marks workspace.create base-ref failures with
    // error.data.code = "base-ref-unresolvable" (monorepo#761); the code is
    // threaded through so consumers key off it instead of the error prose.
    const failed = proposalLifecycleReducer(
      initialState,
      proposalFailed({
        proposalId: 'p1',
        error: "cannot resolve base ref 'nope'",
        errorCode: 'base-ref-unresolvable',
        completedAt: 50,
        lastAction: 'apply',
      }),
    );

    expect(failed.p1.status).toBe('failed');
    expect(failed.p1.errorCode).toBe('base-ref-unresolvable');
  });

  it('clears a stale errorCode when a retry succeeds', () => {
    const failed = proposalLifecycleReducer(
      initialState,
      proposalFailed({
        proposalId: 'p1',
        error: "cannot resolve base ref 'nope'",
        errorCode: 'base-ref-unresolvable',
        completedAt: 50,
        lastAction: 'apply',
      }),
    );
    const applied = proposalLifecycleReducer(
      failed,
      proposalApplySucceeded({ proposalId: 'p1', completedAt: 60 }),
    );

    expect(applied.p1.status).toBe('applied');
    expect(applied.p1.error).toBeUndefined();
    expect(applied.p1.errorCode).toBeUndefined();
  });

  it('stores the workspace-create result when proposalApplySucceeded carries one', () => {
    const applying = proposalLifecycleReducer(
      initialState,
      proposalApplyStarted({ proposalId: 'p1', startedAt: 10 }),
    );
    const applied = proposalLifecycleReducer(
      applying,
      proposalApplySucceeded({
        proposalId: 'p1',
        completedAt: 20,
        result: { workspaceId: 'ws-new' as WorkspaceId },
      }),
    );
    expect(applied.p1.result).toEqual({ workspaceId: 'ws-new' });
    expect(applied.p1.status).toBe('applied');
  });

  it('omits result on proposalApplySucceeded payloads without one', () => {
    const applying = proposalLifecycleReducer(
      initialState,
      proposalApplyStarted({ proposalId: 'p1', startedAt: 10 }),
    );
    const applied = proposalLifecycleReducer(
      applying,
      proposalApplySucceeded({ proposalId: 'p1', completedAt: 20 }),
    );
    expect(applied.p1.result).toBeUndefined();
  });

  it('dedupes duplicate starts while a proposal is busy or already applied', () => {
    const applying = proposalLifecycleReducer(
      initialState,
      proposalApplyStarted({ proposalId: 'p1', startedAt: 10 }),
    );
    expect(
      proposalLifecycleReducer(applying, proposalApplyStarted({ proposalId: 'p1', startedAt: 11 })),
    ).toBe(applying);

    const applied = proposalLifecycleReducer(
      applying,
      proposalApplySucceeded({ proposalId: 'p1', completedAt: 20 }),
    );
    expect(
      proposalLifecycleReducer(applied, proposalApplyStarted({ proposalId: 'p1', startedAt: 21 })),
    ).toBe(applied);

    const undoing = proposalLifecycleReducer(
      applied,
      proposalUndoStarted({ proposalId: 'p1', startedAt: 30 }),
    );
    expect(
      proposalLifecycleReducer(undoing, proposalUndoStarted({ proposalId: 'p1', startedAt: 31 })),
    ).toBe(undoing);
  });

  it('hydrates persisted lifecycle entries', () => {
    expect(
      proposalLifecycleReducer(
        initialState,
        hydrateProposalLifecycle({ p1: { status: 'applied', completedAt: 20 } }),
      ),
    ).toEqual({ p1: { status: 'applied', completedAt: 20 } });
  });

  it('prunes non-applied and expired lifecycle entries before persistence', () => {
    const now = 31 * 24 * 60 * 60 * 1000;
    expect(
      pruneAppliedProposalLifecycleEntries(
        {
          applied: { status: 'applied', completedAt: now },
          expired: { status: 'applied', completedAt: 10 },
          failed: { status: 'failed', completedAt: now, error: 'Nope', lastAction: 'apply' },
        },
        now,
      ),
    ).toEqual({ applied: { status: 'applied', completedAt: now } });
  });
});

/**
 * Setup Prompt Slice Tests
 */

import { describe, it, expect } from 'vitest';
import {
  initialState,
  setupPromptReducer,
  setupEvaluationCompleted,
  setupPromptDismissed,
  bootRouteGateResolved,
} from './setup-prompt-slice';
import type { SetupEvaluation } from './setup-prompt-types';

const EVALUATION: SetupEvaluation = {
  connectionId: 'remote-1',
  isLocal: false,
  setupNeeded: true,
};

describe('setupPromptReducer', () => {
  it('has the expected initial state', () => {
    expect(initialState).toEqual({
      evaluation: null,
      dismissedConnectionIds: [],
      bootRouteGateResolved: false,
    });
  });

  it('stores a completed evaluation', () => {
    const state = setupPromptReducer(initialState, setupEvaluationCompleted(EVALUATION));
    expect(state.evaluation).toEqual(EVALUATION);
  });

  it('replaces a previous evaluation', () => {
    const first = setupPromptReducer(initialState, setupEvaluationCompleted(EVALUATION));
    const next: SetupEvaluation = { connectionId: 'local', isLocal: true, setupNeeded: false };
    const state = setupPromptReducer(first, setupEvaluationCompleted(next));
    expect(state.evaluation).toEqual(next);
  });

  it('records a dismissed connection id', () => {
    const state = setupPromptReducer(initialState, setupPromptDismissed('remote-1'));
    expect(state.dismissedConnectionIds).toEqual(['remote-1']);
  });

  it('does not duplicate an already-dismissed connection id', () => {
    const once = setupPromptReducer(initialState, setupPromptDismissed('remote-1'));
    const twice = setupPromptReducer(once, setupPromptDismissed('remote-1'));
    expect(twice).toBe(once);
    expect(twice.dismissedConnectionIds).toEqual(['remote-1']);
  });

  it('accumulates dismissals across connections', () => {
    let state = setupPromptReducer(initialState, setupPromptDismissed('remote-1'));
    state = setupPromptReducer(state, setupPromptDismissed('remote-2'));
    expect(state.dismissedConnectionIds).toEqual(['remote-1', 'remote-2']);
  });

  it('marks the boot-route gate resolved', () => {
    const state = setupPromptReducer(initialState, bootRouteGateResolved());
    expect(state.bootRouteGateResolved).toBe(true);
  });

  it('resolving the boot-route gate twice is a no-op', () => {
    const once = setupPromptReducer(initialState, bootRouteGateResolved());
    const twice = setupPromptReducer(once, bootRouteGateResolved());
    expect(twice).toBe(once);
  });

  it('a later evaluation does not reset the resolved boot-route gate', () => {
    const resolved = setupPromptReducer(initialState, bootRouteGateResolved());
    const state = setupPromptReducer(resolved, setupEvaluationCompleted(EVALUATION));
    expect(state.bootRouteGateResolved).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  agentMutationUiConsumed,
  agentMutationUiFinished,
  agentMutationUiReducer as reducer,
  agentMutationUiReleased,
  agentMutationUiRequested,
} from './agent-mutation-ui-slice';
import { selectAgentMutationUi } from './agent-mutation-ui-selectors';

describe('agent mutation UI ownership', () => {
  it('keeps initial and irrelevant transitions referentially stable', () => {
    const state = reducer.initialState;
    expect(state).toEqual({ byWorkspaceId: {} });
    expect(reducer(state, { type: 'unrelated' })).toBe(state);
    expect(reducer(state, agentMutationUiFinished('ws', 'card', 'r1', 'succeeded'))).toBe(state);
    expect(reducer(state, agentMutationUiReleased('ws', 'card'))).toBe(state);
  });

  it('correlates request, resource, consumer and workspace; consumes only the current outcome', () => {
    const request = agentMutationUiRequested('ws', 'card', 'r1', 'agent', { kind: 'retire' });
    const initial = reducer(reducer.initialState, request);
    expect(reducer(initial, request)).toBe(initial);
    expect(reducer(initial, agentMutationUiConsumed('ws', 'card', 'r1'))).toBe(initial);
    const newer = reducer(
      initial,
      agentMutationUiRequested('ws', 'card', 'r2', 'other-agent', { kind: 'stop' }),
    );
    expect(reducer(newer, agentMutationUiFinished('ws', 'card', 'r1', 'failed', 'old error'))).toBe(
      newer,
    );
    expect(reducer(newer, agentMutationUiFinished('elsewhere', 'card', 'r2', 'succeeded'))).toBe(
      newer,
    );
    const completed = reducer(
      newer,
      agentMutationUiFinished('ws', 'card', 'r2', 'failed', 'refused'),
    );
    const entry = selectAgentMutationUi.select({ agentMutationUi: completed } as any, 'ws', 'card');
    expect(entry).toMatchObject({
      requestId: 'r2',
      agentId: 'other-agent',
      status: 'failed',
      error: 'refused',
    });
    expect(JSON.parse(JSON.stringify(completed))).toEqual(completed);
    expect(reducer(completed, agentMutationUiFinished('ws', 'card', 'r2', 'succeeded'))).toBe(
      completed,
    );
    expect(reducer(completed, agentMutationUiConsumed('ws', 'card', 'r1'))).toBe(completed);
    const consumed = reducer(completed, agentMutationUiConsumed('ws', 'card', 'r2'));
    expect(reducer(consumed, agentMutationUiConsumed('ws', 'card', 'r2'))).toBe(consumed);
    expect(
      reducer(
        consumed,
        agentMutationUiRequested('ws', 'card', 'r2', 'other-agent', { kind: 'stop' }),
      ),
    ).toBe(consumed);
    expect(
      selectAgentMutationUi.select({ agentMutationUi: consumed } as any, 'ws', 'card'),
    ).toBeUndefined();
  });

  it('rejects completions after consumer release and workspace teardown', () => {
    const requested = reducer(
      reducer.initialState,
      agentMutationUiRequested('ws', 'card', 'r1', 'agent', { kind: 'retire' }),
    );
    const released = reducer(requested, agentMutationUiReleased('ws', 'card'));
    expect(reducer(released, agentMutationUiFinished('ws', 'card', 'r1', 'succeeded'))).toBe(
      released,
    );
    const unmounted = reducer(requested, workspaceUnmounted('ws'));
    expect(unmounted).toEqual(reducer.initialState);
    expect(reducer(unmounted, agentMutationUiFinished('ws', 'card', 'r1', 'succeeded'))).toBe(
      unmounted,
    );
  });
});

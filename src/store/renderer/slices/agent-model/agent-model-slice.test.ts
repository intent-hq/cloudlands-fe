import { describe, expect, it } from 'vitest';
import {
  agentModelReducer,
  agentModelMutationRequested,
  agentModelMutationConsumed,
} from './agent-model-slice';
import type { AgentModelRequest } from './agent-model-types';

const request: AgentModelRequest = {
  requestId: 'request',
  consumerId: 'picker',
  agentId: 'agent',
  workspaceId: 'workspace',
  connection: 'connection',
  operation: { kind: 'model', model: 'next', commit: true },
};
describe('agent model mutation outcomes', () => {
  it('starts empty and stores only serializable identity and status, not callbacks', () => {
    const initial = agentModelReducer(undefined, { type: 'init' });
    expect(initial.mutations.ids).toEqual([]);
    const pending = agentModelReducer(
      initial,
      agentModelMutationRequested(request, { canSend: () => true }),
    );
    expect(structuredClone(pending)).toEqual(pending);
    expect(pending.mutations.map.request).toEqual({
      requestId: 'request',
      consumerId: 'picker',
      agentId: 'agent',
      workspaceId: 'workspace',
      connection: 'connection',
      status: 'pending',
    });
  });
  it.each(['success', 'failure', 'cancelled'] as const)(
    'settles %s once and consumes only the matching consumer',
    (status) => {
      const action = agentModelMutationRequested(request);
      let state = agentModelReducer(undefined, action);
      state = agentModelReducer(
        state,
        action.success({ status, modelAccepted: true, error: 'detail' }),
      );
      expect(state.mutations.map.request).toMatchObject({
        status,
        modelAccepted: true,
        error: 'detail',
      });
      expect(agentModelReducer(state, action.failure(new Error('late')))).toBe(state);
      expect(agentModelReducer(state, agentModelMutationConsumed('request', 'other'))).toBe(state);
      state = agentModelReducer(state, agentModelMutationConsumed('request', 'picker'));
      expect(state.mutations.ids).toEqual([]);
      expect(agentModelReducer(state, action.success({ status: 'success' }))).toBe(state);
    },
  );
  it.each(['consumerId', 'agentId', 'workspaceId', 'connection'] as const)(
    'ignores a settlement with a stale %s',
    (field) => {
      const action = agentModelMutationRequested(request);
      const state = agentModelReducer(undefined, action);
      const stale = agentModelMutationRequested({ ...request, [field]: 'different' });
      expect(agentModelReducer(state, stale.success({ status: 'success' }))).toBe(state);
      expect(agentModelReducer(state, stale.failure(new Error('obsolete')))).toBe(state);
    },
  );
  it('converts an unexpected execution error into a consumable string outcome', () => {
    const action = agentModelMutationRequested(request);
    const state = agentModelReducer(
      agentModelReducer(undefined, action),
      action.failure(new Error('transport')),
    );
    expect(state.mutations.map.request).toMatchObject({ status: 'failure', error: 'transport' });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
  it('keeps an effort-only result JSON-serializable without model outcome fields', () => {
    const action = agentModelMutationRequested({
      ...request,
      operation: { kind: 'effort', effort: 'high', previous: null },
    });
    const state = agentModelReducer(
      agentModelReducer(undefined, action),
      action.success({ status: 'success' }),
    );
    expect(state.mutations.map.request.status).toBe('success');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

import { describe, expect, it } from 'vitest';
import { agentLockReducer, setAgentLockState } from '../slices/agent-lock/agent-lock-slice';
import { RendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoveryMiddleware,
  getRecoveryLifetime,
  getRecoveryAdmission,
  observeRecoveryActionIngress,
  withRecoveryAdmissions,
  withRecoveryLifetime,
} from './event-recovery';

describe('recovery action receipt', () => {
  it('rejects missing integrated admissions while preserving untagged legacy actions', () => {
    const legacy = { type: 'event' };
    const admitted = withRecoveryAdmissions({ type: 'event' }, new Map());
    expect(getRecoveryAdmission(legacy, 'retired')).toBeUndefined();
    expect(getRecoveryAdmission(admitted, 'retired')).toBeNull();
  });
  it('runs admitted command ingress before the reducer and removes observers with their owner', () => {
    const order: string[] = [];
    const off = observeRecoveryActionIngress(() => {
      order.push('ingress');
      return () => {
        order.push('abandon');
      };
    });
    const dispatch = (createEventRecoveryMiddleware() as any)({})((action: object) => {
      order.push('reducer');
      return action;
    });
    dispatch({ type: 'command' });
    expect(order).toEqual(['ingress', 'reducer']);
    off();
    dispatch({ type: 'command' });
    expect(order).toEqual(['ingress', 'reducer', 'reducer']);
  });
  it('checks lifetime when a queued action reaches the reducer and preserves legacy actions', () => {
    const registry = new RendererEventRecovery();
    let state = agentLockReducer(undefined, { type: '@@init' });
    const dispatch = (createEventRecoveryMiddleware() as any)({})(
      (action: ReturnType<typeof setAgentLockState>) => {
        state = agentLockReducer(state, action);
        return action;
      },
    );
    const receipt = registry.capture('locks:ws');
    const delayed = withRecoveryLifetime(setAgentLockState('ws', { stale: true }, {}), receipt);
    expect(getRecoveryLifetime(delayed)).toBe(receipt);
    registry.dispose();
    dispatch(setAgentLockState('ws', { current: true }, {}));
    dispatch(delayed);
    expect(state.byWorkspaceId.ws.lockedAgentIds).toEqual({ current: true });
    expect(JSON.stringify(delayed)).not.toContain('commit');
    const next = withRecoveryLifetime(
      setAgentLockState('ws', { next: true }, {}),
      registry.capture('locks:ws'),
    );
    expect(dispatch(next)).toBe(next);
    expect(state.byWorkspaceId.ws.lockedAgentIds).toEqual({ next: true });
  });
});

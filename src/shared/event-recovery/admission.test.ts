import { describe, expect, it, vi } from 'vitest';
import corpus from './__fixtures__/contract.json';
import { RecoveryAdmission } from './admission';

describe('canonical loss admission', () => {
  for (const fixture of corpus.admission) {
    it(fixture.id, () => {
      const context = {};
      const invalidate = vi.fn();
      const admission = new RecoveryAdmission(context, invalidate);
      if (fixture.lease) {
        const attempt = admission.begin({
          workspaceId: fixture.lease.workspaceId,
          eventTypes: ['file:*'],
        });
        admission.admit(attempt, fixture.lease.subscriptionId, fixture.lease.lossRecovery === 1);
        if (fixture.lastGeneration)
          admission.receive(context, {
            ...fixture.frame.params,
            generation: fixture.lastGeneration,
          });
        if (fixture.lease.retired) admission.retire(fixture.lease.subscriptionId);
      }
      invalidate.mockClear();
      admission.receive(fixture.deliveryContext ? {} : context, fixture.frame.params);
      expect(invalidate).toHaveBeenCalledTimes(fixture.expected === 'invalidate' ? 1 : 0);
    });
  }

  it('stages greatest exact generation only until matching ack', () => {
    const context = {},
      invalidated = vi.fn();
    const admission = new RecoveryAdmission(context, invalidated);
    const attempt = admission.begin({ workspaceId: 'ws-a', eventTypes: ['file:*'] });
    const marker = {
      subscriptionId: 'a',
      scope: { workspaceId: 'ws-a' },
      generation: '9007199254740993',
    };
    admission.receive(context, marker);
    admission.receive(context, { ...marker, generation: '9007199254740992' });
    expect(invalidated).not.toHaveBeenCalled();
    admission.admit(attempt, 'a', true);
    expect(invalidated).toHaveBeenCalledOnce();
    admission.receive(context, marker);
    expect(invalidated).toHaveBeenCalledOnce();
  });

  it('bounds early IDs and conservatively invalidates admitted attempts once', () => {
    const context = {},
      invalidated = vi.fn();
    const admission = new RecoveryAdmission(context, invalidated);
    const a = admission.begin({ workspaceId: 'ws-a', eventTypes: ['file:*'] });
    const b = admission.begin({ workspaceId: 'ws-a', eventTypes: ['file:*'] });
    for (let i = 0; i < 100; i++)
      admission.receive(context, {
        subscriptionId: String(i),
        generation: '1',
        scope: { workspaceId: 'ws-a' },
      });
    expect(admission.stagedCount).toBeLessThanOrEqual(corpus.policy.maxEarlyMarkerIds);
    expect(invalidated).not.toHaveBeenCalled();
    admission.admit(a, 'a', true);
    admission.admit(b, 'b', true);
    expect(invalidated).toHaveBeenCalledTimes(2);
    expect(admission.stagedCount).toBe(0);
  });

  it('rejects late admission and retired IDs during another pending attempt', () => {
    const context = {},
      invalidated = vi.fn();
    const admission = new RecoveryAdmission(context, invalidated);
    const a = admission.begin({ workspaceId: 'ws-a', eventTypes: ['file:*'] });
    admission.admit(a, 'a', true);
    admission.retire('a');
    const b = admission.begin({ workspaceId: 'ws-a', eventTypes: ['file:*'] });
    admission.receive(context, {
      subscriptionId: 'a',
      generation: '1',
      scope: { workspaceId: 'ws-a' },
    });
    admission.dispose();
    expect(admission.admit(b, 'b', true)).toBeUndefined();
    expect(invalidated).not.toHaveBeenCalled();
  });
});

import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { planManager } from '$features/acp-official/plans/plan-manager';
import type { AgentId } from '$shared/types/branded-ids';
import {
  applyNativePlanCleared,
  applyNativePlanUpdated,
} from '../native-plans-slice';
import { nativePlansSaga, toNativePlanEntries } from './native-plans-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('nativePlansSaga', () => {
  afterEach(() => {
    for (const plan of planManager.getAllPlans()) {
      planManager.clearPlan(plan.sessionId);
    }
    vi.clearAllMocks();
  });

  it('mirrors plan:updated and plan:cleared into slice actions', async () => {
    const dispatched: unknown[] = [];
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: (action: unknown) => dispatched.push(action), getState: () => ({}) },
      nativePlansSaga,
    );
    await settle();

    planManager.updatePlan('acp-session-1' as AgentId, [
      { id: 'e1', title: 'Analyze', status: 'in_progress' },
      { id: 'e2', title: 'Implement', status: 'pending' },
    ]);
    await settle();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual(
      applyNativePlanUpdated('acp-session-1', [
        { id: 'e1', title: 'Analyze', status: 'in_progress' },
        { id: 'e2', title: 'Implement', status: 'pending' },
      ]),
    );

    planManager.clearPlan('acp-session-1' as AgentId);
    await settle();

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual(applyNativePlanCleared('acp-session-1'));

    task.cancel();
  });

  it('stops listening after cancellation', async () => {
    const dispatched: unknown[] = [];
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: (action: unknown) => dispatched.push(action), getState: () => ({}) },
      nativePlansSaga,
    );
    await settle();
    task.cancel();
    await settle();

    planManager.updatePlan('acp-session-2' as AgentId, [
      { id: 'e1', title: 'X', status: 'pending' },
    ]);
    await settle();

    expect(dispatched).toHaveLength(0);
  });
});

describe('toNativePlanEntries', () => {
  it('keeps canonical fields, recurses children, and drops presentation extras', () => {
    const entries = toNativePlanEntries([
      {
        id: 'root',
        title: 'Root',
        status: 'in_progress',
        icon: '⏳',
        color: 'blue',
        progress: 50,
        startedAt: 123,
        children: [
          { id: 'child', title: 'Child', status: 'completed', icon: '✅', color: 'green' },
        ],
      },
    ]);

    expect(entries).toEqual([
      {
        id: 'root',
        title: 'Root',
        status: 'in_progress',
        children: [{ id: 'child', title: 'Child', status: 'completed' }],
      },
    ]);
  });
});

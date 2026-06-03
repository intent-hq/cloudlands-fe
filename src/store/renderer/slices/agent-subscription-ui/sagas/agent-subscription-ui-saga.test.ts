import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as sagaEffects from 'redux-saga/effects';

// Must mock typed-redux-saga before importing any saga module
vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield {
      '@@redux-saga/IO': true,
      combinator: false,
      type: 'CANCEL',
      payload: task,
    };
  },
}));

const {
  invokeMock,
  selectTrackedAgentIdsMock,
  selectWaitingStateMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  selectTrackedAgentIdsMock: vi.fn(() => []),
  selectWaitingStateMock: vi.fn(() => 'idle'),
}));

vi.mock('$lib/electron-bridge', async () => ({
  ...(await import('$store/renderer/utils/test-helpers/electron-bridge-mock')),
  invoke: invokeMock,
}));

vi.mock('../agent-subscription-ui-selectors', () => ({
  selectTrackedAgentIds: {
    select: (...args: any[]) => selectTrackedAgentIdsMock(...args),
    effect: function* (...args: any[]) {
      return yield sagaEffects.select(selectTrackedAgentIdsMock, ...args);
    },
  },
  selectWaitingState: {
    select: (...args: any[]) => selectWaitingStateMock(...args),
    effect: function* (...args: any[]) {
      return yield sagaEffects.select(selectWaitingStateMock, ...args);
    },
  },
}));

vi.mock('../../workspace-lifecycle/workspace-lifecycle-slice', () => ({
  workspaceMounted: Object.assign((wsId: string) => ({
    type: 'workspace-lifecycle/workspaceMounted',
    payload: [wsId],
  }), { type: 'workspace-lifecycle/workspaceMounted', toString: () => 'workspace-lifecycle/workspaceMounted' }),
  workspaceUnmounted: Object.assign((wsId: string) => ({
    type: 'workspace-lifecycle/workspaceUnmounted',
    payload: [wsId],
  }), { type: 'workspace-lifecycle/workspaceUnmounted', toString: () => 'workspace-lifecycle/workspaceUnmounted' }),
}));

import {
  agentSubscriptionUISaga,
  handleWorkspaceUnmounted,
  retroactiveMountCheckSaga,
  fetchAndDispatchSnapshot,
  refreshAgentFromAgentIdEvent,
  refreshAgentFromTargetAgentIdEvent,
  handleAgentSubscriptionsChangedEvent,
  handleAgentSubscriptionsRestoredEvent,
  handleAgentWokenBySubscriptionEvent,
  handleAgentStoppedEvent,
  _getWakeupGeneration,
  _getCompletionGeneration,
} from './agent-subscription-ui-saga';
import { takeEveryFromListenSync } from '$store/renderer/utils/ipc-channel';
import type { ElectronEventName } from '$shared/ipc-registry';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
  requestSubscriptionFetch,
} from '../agent-subscription-ui-slice';

const WS = 'ws-test';
const AGENT = 'agent-test';

describe('agent-subscription-ui-saga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('agentSubscriptionUISaga (root)', () => {
    it('directly registers long-lived IPC listeners and action watchers', () => {
      const iterator = agentSubscriptionUISaga();
      const expectedRegistrations: Array<[
        ElectronEventName,
        (...args: any[]) => Generator<any, void, any>,
      ]> = [
        ['agent:subscribed', refreshAgentFromAgentIdEvent],
        ['agent:unsubscribed', refreshAgentFromAgentIdEvent],
        ['agent:subscriptions-changed', handleAgentSubscriptionsChangedEvent],
        ['agent:idle', refreshAgentFromAgentIdEvent],
        ['agent:stopped', handleAgentStoppedEvent],
        ['agent:status-changed', refreshAgentFromAgentIdEvent],
        ['agent:created', refreshAgentFromAgentIdEvent],
        ['agent:woken-by-subscription', handleAgentWokenBySubscriptionEvent],
        ['agent:event-delivery-failed', refreshAgentFromTargetAgentIdEvent],
        ['agent:event-delivery-timeout', refreshAgentFromTargetAgentIdEvent],
        ['agent:subscriptions-restored', handleAgentSubscriptionsRestoredEvent],
      ];

      for (const [eventName, handler] of expectedRegistrations) {
        const effect = iterator.next().value as any;
        expect(effect.type).toBe('FORK');
        expect(effect.payload.fn).not.toBe(takeEveryFromListenSync);
        expect(effect.payload.args).toEqual([eventName, handler]);
      }

      expect(iterator.next().value).toEqual(
        sagaEffects.takeEvery(workspaceUnmounted, handleWorkspaceUnmounted),
      );
      expect(iterator.next().value).toEqual(
        sagaEffects.takeEvery(requestSubscriptionFetch, expect.any(Function)),
      );

      expect(iterator.next().done).toBe(true);
    });
  });

  describe('retroactiveMountCheckSaga', () => {
    it('is a no-op because IPC listeners are no longer workspace-mounted', () => {
      const iterator = retroactiveMountCheckSaga();
      expect(iterator.next().done).toBe(true);
    });
  });

  describe('fetchAndDispatchSnapshot', () => {
    it('dispatches setSubscriptionSnapshot on successful IPC call', () => {
      selectWaitingStateMock.mockReturnValue('idle');
      invokeMock.mockResolvedValue({
        success: true,
        data: [{ id: 's1', agentId: AGENT, eventTypes: ['file:*'], actorIds: [], createdAt: '', description: '' }],
        delegationGroups: [],
        agentStatuses: {},
      });

      const iterator = fetchAndDispatchSnapshot(WS, AGENT);

      // select previousWaitingState
      iterator.next();
      // call invoke
      const callEffect = iterator.next('idle');
      expect(callEffect.done).toBe(false);

      // Simulate successful response
      const response = {
        success: true,
        data: [{ id: 's1', agentId: AGENT, eventTypes: ['file:*'], actorIds: [], createdAt: '', description: '' }],
        delegationGroups: [],
        agentStatuses: {},
      };
      const putEffect = iterator.next(response);
      expect(putEffect.done).toBe(false);

      // Should dispatch setSubscriptionSnapshot
      const expectedAction = setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: response.data,
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      });
      expect((putEffect.value as any)?.payload?.action?.type).toBe(expectedAction.type);
    });

    it('does not dispatch when IPC call fails', () => {
      selectWaitingStateMock.mockReturnValue('idle');
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // select
      iterator.next('idle'); // call invoke

      // Simulate error
      const result = iterator.throw?.(new Error('IPC error'));
      // Should complete without throwing
      expect(result?.done).toBe(true);
    });

    it('does not dispatch when result is not successful', () => {
      selectWaitingStateMock.mockReturnValue('idle');
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // select
      iterator.next('idle'); // call invoke

      // Simulate unsuccessful response
      const result = iterator.next({ success: false });
      expect(result.done).toBe(true);
    });

    it('sets waitingState to idle when no subscriptions and previously idle', () => {
      selectWaitingStateMock.mockReturnValue('idle');
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // select
      iterator.next('idle'); // call invoke

      const response = {
        success: true,
        data: [],
        delegationGroups: [],
        agentStatuses: {},
      };
      const putEffect = iterator.next(response);
      expect(putEffect.done).toBe(false);

      const expectedAction = setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      });
      expect((putEffect.value as any)?.payload?.action?.type).toBe(expectedAction.type);
      expect((putEffect.value as any)?.payload?.action?.payload?.data?.waitingState).toBe('idle');
    });

    it('transitions to completed when previously waiting and snapshot is empty', () => {
      selectWaitingStateMock.mockReturnValue('waiting');
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // select
      iterator.next('waiting'); // provide previous state, call invoke

      const response = {
        success: true,
        data: [],
        delegationGroups: [],
        agentStatuses: {},
      };
      const putEffect = iterator.next(response);
      expect(putEffect.done).toBe(false);

      // Should dispatch with waitingState: 'completed'
      expect((putEffect.value as any)?.payload?.action?.payload?.data?.waitingState).toBe('completed');

      // Should fork delayed cleanup
      const forkEffect = iterator.next();
      expect(forkEffect.done).toBe(false);
      expect((forkEffect.value as any)?.type).toBe('FORK');

      // Verify completion generation was set
      const key = `${WS}:${AGENT}`;
      const gen = _getCompletionGeneration(key);
      expect(gen).toBeGreaterThan(0);

      // Run the forked cleanup generator
      const innerFn = (forkEffect.value as any)?.payload?.fn;
      const inner = innerFn();

      // delay(3000)
      const delayEff = inner.next();
      expect(delayEff.done).toBe(false);

      // After delay: generation check passes, then re-fetch snapshot
      const refetchEff = inner.next();
      expect(refetchEff.done).toBe(false);
      // Provide empty re-fetch result so reset proceeds
      const resetEff = inner.next({ success: true, data: [], delegationGroups: [] });
      expect(resetEff.done).toBe(false);
      expect((resetEff.value as any)?.payload?.action?.type).toBe(resetSubscriptionUI(WS, AGENT).type);
    });

    it('transitions to completed when previously woken and snapshot is empty', () => {
      selectWaitingStateMock.mockReturnValue('woken');
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // select
      iterator.next('woken'); // provide previous state

      const response = {
        success: true,
        data: [],
        delegationGroups: [],
        agentStatuses: {},
      };
      const putEffect = iterator.next(response);
      expect(putEffect.done).toBe(false);
      expect((putEffect.value as any)?.payload?.action?.payload?.data?.waitingState).toBe('completed');
    });

    it('newer completion resets cleanup timer (generation counter)', () => {
      selectWaitingStateMock.mockReturnValue('waiting');
      const key = `${WS}:${AGENT}`;

      // First completion
      const it1 = fetchAndDispatchSnapshot(WS, AGENT);
      it1.next(); // select
      it1.next('waiting'); // call invoke
      it1.next({ success: true, data: [], delegationGroups: [], agentStatuses: {} }); // put
      const fork1 = it1.next(); // fork
      const gen1 = _getCompletionGeneration(key);

      // Second completion (arrives before first cleanup fires)
      const it2 = fetchAndDispatchSnapshot(WS, AGENT);
      it2.next(); // select
      it2.next('waiting'); // call invoke
      it2.next({ success: true, data: [], delegationGroups: [], agentStatuses: {} }); // put
      const fork2 = it2.next(); // fork
      const gen2 = _getCompletionGeneration(key);
      expect(gen2).toBe(gen1 + 1);

      // First fork's cleanup fires — generation mismatch → should NOT resetSubscriptionUI
      const innerFn1 = (fork1.value as any)?.payload?.fn;
      const inner1 = innerFn1();
      inner1.next(); // delay
      const after1 = inner1.next(); // check generation
      expect(after1.done).toBe(true); // No reset dispatched

      // Second fork's cleanup fires — generation matches → SHOULD resetSubscriptionUI
      const innerFn2 = (fork2.value as any)?.payload?.fn;
      const inner2 = innerFn2();
      inner2.next(); // delay
      const refetchEff2 = inner2.next(); // generation check passes → re-fetch
      expect(refetchEff2.done).toBe(false);
      // Provide empty re-fetch result so reset proceeds
      const resetEff = inner2.next({ success: true, data: [], delegationGroups: [] });
      expect(resetEff.done).toBe(false);
      expect((resetEff.value as any)?.payload?.action?.type).toBe(resetSubscriptionUI(WS, AGENT).type);
    });
  });

  describe('event-specific handlers', () => {
    it('refreshes all tracked agents on subscriptions-changed without agentId', () => {
      const trackedAgents = ['agent-1', 'agent-2'];
      selectTrackedAgentIdsMock.mockReturnValue(trackedAgents);

      const iterator = handleAgentSubscriptionsChangedEvent({
        workspaceId: WS,
        agentId: undefined,
      });

      // select trackedAgentIds
      const selectEffect = iterator.next();
      expect(selectEffect.done).toBe(false);

      // Provide tracked agent IDs
      const callEffect1 = iterator.next(trackedAgents);
      expect(callEffect1.done).toBe(false);
      // Should call fetchAndDispatchSnapshot for agent-1
      expect((callEffect1.value as any)?.payload?.args).toEqual([WS, 'agent-1']);

      const callEffect2 = iterator.next();
      expect(callEffect2.done).toBe(false);
      // Should call fetchAndDispatchSnapshot for agent-2
      expect((callEffect2.value as any)?.payload?.args).toEqual([WS, 'agent-2']);

      // Should return after processing all tracked agents
      const done = iterator.next();
      expect(done.done).toBe(true);
    });

    it('returns early for agent-scoped events without agentId', () => {
      const iterator = refreshAgentFromAgentIdEvent({
        workspaceId: WS,
        agentId: undefined,
      });

      // Should return immediately without any effects
      const result = iterator.next();
      expect(result.done).toBe(true);
    });

    it('fetches snapshot for specific agent when agentId is present', () => {
      invokeMock.mockResolvedValue({ success: true, data: [], delegationGroups: [], agentStatuses: {} });

      const iterator = refreshAgentFromAgentIdEvent({
        workspaceId: WS,
        agentId: AGENT,
      });

      // Should call fetchAndDispatchSnapshot with the specific agentId
      const callEffect = iterator.next();
      expect(callEffect.done).toBe(false);
      expect((callEffect.value as any)?.payload?.args).toEqual([WS, AGENT]);
    });

    it('ignores agent-scoped events that are missing workspaceId', () => {
      const iterator = refreshAgentFromAgentIdEvent({
        agentId: AGENT,
      });

      expect(iterator.next().done).toBe(true);
    });

    it('uses targetAgentId for delivery failure events', () => {
      const iterator = refreshAgentFromTargetAgentIdEvent({
        workspaceId: WS,
        targetAgentId: AGENT,
      });

      const callEffect = iterator.next();
      expect(callEffect.done).toBe(false);
      expect((callEffect.value as any)?.payload?.args).toEqual([WS, AGENT]);
    });

    it('ignores target-agent events that are missing targetAgentId', () => {
      const iterator = refreshAgentFromTargetAgentIdEvent({
        workspaceId: WS,
        targetAgentId: undefined,
      });

      expect(iterator.next().done).toBe(true);
    });

    it('refreshes restored subscription agentIds', () => {
      const iterator = handleAgentSubscriptionsRestoredEvent({
        workspaceId: WS,
        agentIds: ['agent-1', '', 'agent-2'],
      });

      const callEffect1 = iterator.next();
      expect(callEffect1.done).toBe(false);
      expect((callEffect1.value as any)?.payload?.args).toEqual([WS, 'agent-1']);

      const callEffect2 = iterator.next();
      expect(callEffect2.done).toBe(false);
      expect((callEffect2.value as any)?.payload?.args).toEqual([WS, 'agent-2']);

      expect(iterator.next().done).toBe(true);
    });

    it('stopped events use payload workspaceId and agentId for unsubscribe/reset', () => {
      const iterator = handleAgentStoppedEvent({
        workspaceId: WS,
        agentId: AGENT,
      });

      const fetchEffect = iterator.next();
      expect(fetchEffect.done).toBe(false);
      expect((fetchEffect.value as any)?.payload?.args).toEqual([WS, AGENT]);

      const unsubscribeEffect = iterator.next();
      expect(unsubscribeEffect.done).toBe(false);
      expect((unsubscribeEffect.value as any)?.payload?.args).toEqual([
        'events:unsubscribe-agent',
        { workspaceId: WS, agentId: AGENT },
      ]);

      const resetEffect = iterator.next();
      expect(resetEffect.done).toBe(false);
      expect((resetEffect.value as any)?.payload?.action).toEqual(resetSubscriptionUI(WS, AGENT));
    });

    it('handles empty tracked agents list gracefully', () => {
      selectTrackedAgentIdsMock.mockReturnValue([]);

      const iterator = handleAgentSubscriptionsChangedEvent({
        workspaceId: WS,
        agentId: undefined,
      });

      // select trackedAgentIds
      iterator.next();

      // Provide empty list - should complete immediately
      const done = iterator.next([]);
      expect(done.done).toBe(true);
    });

    it('woken-by-subscription forks auto-dismiss that respects newer wakeups (race-condition fix)', () => {
      // Simulate two rapid woken-by-subscription events. The first fork's
      // clearWokenUp should NOT fire after the second wakeup arrives,
      // because a newer generation has been set.
      invokeMock.mockResolvedValue({ success: true, data: [], delegationGroups: [], agentStatuses: {} });

      // --- First wakeup ---
      const it1 = handleAgentWokenBySubscriptionEvent({
        workspaceId: WS,
        agentId: AGENT,
        eventCount: 1,
        eventTypes: ['file:*'],
      });

      // call(fetchAndDispatchSnapshot, WS, AGENT)
      const callEff1 = it1.next();
      expect(callEff1.done).toBe(false);
      // After call returns, saga continues to fork
      const fork1 = it1.next();
      expect(fork1.done).toBe(false);
      expect((fork1.value as any)?.type).toBe('FORK');

      // Capture generation after first wakeup
      const key = `${WS}:${AGENT}`;
      const gen1 = _getWakeupGeneration(key);
      expect(gen1).toBeGreaterThan(0);

      // --- Second wakeup (arrives before the 5s dismiss) ---
      const it2 = handleAgentWokenBySubscriptionEvent({
        workspaceId: WS,
        agentId: AGENT,
        eventCount: 2,
        eventTypes: ['agent:*'],
      });

      it2.next(); // call fetchAndDispatchSnapshot
      const fork2 = it2.next(); // fork
      expect((fork2.value as any)?.type).toBe('FORK');

      // Generation should have bumped
      const gen2 = _getWakeupGeneration(key);
      expect(gen2).toBe(gen1 + 1);

      // Now run the first fork's inner generator.
      // It should set wokenUp then delay then check generation → skip clearWokenUp
      const innerFn1 = (fork1.value as any)?.payload?.fn;
      const inner1 = innerFn1();

      // put setWokenUp
      const putWoken1 = inner1.next();
      expect(putWoken1.done).toBe(false);
      expect((putWoken1.value as any)?.payload?.action?.type).toBe(setWokenUp(WS, AGENT, { eventCount: 1, eventTypes: ['file:*'], timestamp: 0 }).type);

      // delay 5000
      const delayEff1 = inner1.next();
      expect(delayEff1.done).toBe(false);

      // After delay completes, the fork checks generation.
      // Since gen2 > gen1, it should NOT dispatch clearWokenUp — just return.
      const afterDelay1 = inner1.next();
      expect(afterDelay1.done).toBe(true);
      // Verify no clearWokenUp was dispatched (done is true, no more effects)

      // The second fork SHOULD clear, because no newer wakeup superseded it.
      const innerFn2 = (fork2.value as any)?.payload?.fn;
      const inner2 = innerFn2();
      inner2.next(); // put setWokenUp
      inner2.next(); // delay 5000
      // After delay, generation still matches → should dispatch clearWokenUp
      const clearEff = inner2.next();
      expect(clearEff.done).toBe(false);
      expect((clearEff.value as any)?.payload?.action?.type).toBe(clearWokenUp(WS, AGENT).type);
    });

    it('generation counter works correctly for 3+ rapid wakeups (Bug 1 edge case)', () => {
      // Three rapid wakeups: only the last fork's auto-dismiss should fire.
      invokeMock.mockResolvedValue({ success: true, data: [], delegationGroups: [], agentStatuses: {} });

      const key = `${WS}:${AGENT}`;

      // --- Wakeup 1 ---
      const it1 = handleAgentWokenBySubscriptionEvent({
        workspaceId: WS,
        agentId: AGENT,
        eventCount: 1,
        eventTypes: ['file:*'],
      });
      it1.next(); // call fetchAndDispatchSnapshot
      const fork1 = it1.next();
      const gen1 = _getWakeupGeneration(key);
      expect(gen1).toBeGreaterThan(0);

      // --- Wakeup 2 ---
      const it2 = handleAgentWokenBySubscriptionEvent({
        workspaceId: WS,
        agentId: AGENT,
        eventCount: 2,
        eventTypes: ['agent:*'],
      });
      it2.next();
      const fork2 = it2.next();
      const gen2 = _getWakeupGeneration(key);
      expect(gen2).toBe(gen1 + 1);

      // --- Wakeup 3 ---
      const it3 = handleAgentWokenBySubscriptionEvent({
        workspaceId: WS,
        agentId: AGENT,
        eventCount: 3,
        eventTypes: ['task:*'],
      });
      it3.next();
      const fork3 = it3.next();
      const gen3 = _getWakeupGeneration(key);
      expect(gen3).toBe(gen2 + 1);

      // Fork 1 delay finishes — generation mismatch → should NOT clearWokenUp
      const innerFn1 = (fork1.value as any)?.payload?.fn;
      const inner1 = innerFn1();
      inner1.next(); // put setWokenUp
      inner1.next(); // delay 5000
      const after1 = inner1.next();
      expect(after1.done).toBe(true); // No clearWokenUp dispatched

      // Fork 2 delay finishes — generation mismatch → should NOT clearWokenUp
      const innerFn2 = (fork2.value as any)?.payload?.fn;
      const inner2 = innerFn2();
      inner2.next(); // put setWokenUp
      inner2.next(); // delay 5000
      const after2 = inner2.next();
      expect(after2.done).toBe(true); // No clearWokenUp dispatched

      // Fork 3 delay finishes — generation MATCHES → SHOULD clearWokenUp
      const innerFn3 = (fork3.value as any)?.payload?.fn;
      const inner3 = innerFn3();
      inner3.next(); // put setWokenUp
      inner3.next(); // delay 5000
      const clearEff3 = inner3.next();
      expect(clearEff3.done).toBe(false);
      expect((clearEff3.value as any)?.payload?.action?.type).toBe(clearWokenUp(WS, AGENT).type);
    });
  });
});

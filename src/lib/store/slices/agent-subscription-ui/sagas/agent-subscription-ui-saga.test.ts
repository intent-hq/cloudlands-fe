import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { selectActiveWorkspaceIdMock, invokeMock } = vi.hoisted(() => ({
  selectActiveWorkspaceIdMock: vi.fn(() => null),
  invokeMock: vi.fn(),
}));

vi.mock('$lib/electron-bridge', async () => ({
  ...(await import('$lib/store/utils/test-helpers/electron-bridge-mock')),
  invoke: invokeMock,
}));

vi.mock('../../workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: {
    select: (...args: any[]) => selectActiveWorkspaceIdMock(...args),
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
  handleWorkspaceMounted,
  handleWorkspaceUnmounted,
  retroactiveMountCheckSaga,
  fetchAndDispatchSnapshot,
} from './agent-subscription-ui-saga';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
} from '../agent-subscription-ui-slice';

const WS = 'ws-test';
const AGENT = 'agent-test';

describe('agent-subscription-ui-saga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('agentSubscriptionUISaga (root)', () => {
    it('registers workspace lifecycle watchers and forks retroactive check', () => {
      const iterator = agentSubscriptionUISaga();

      // takeEvery workspaceMounted
      const step1 = iterator.next();
      expect(step1.done).toBe(false);
      expect(step1.value).toEqual(
        sagaEffects.takeEvery(workspaceMounted, handleWorkspaceMounted),
      );

      // takeEvery workspaceUnmounted
      const step2 = iterator.next();
      expect(step2.done).toBe(false);
      expect(step2.value).toEqual(
        sagaEffects.takeEvery(workspaceUnmounted, handleWorkspaceUnmounted),
      );

      // fork retroactive mount check
      const step3 = iterator.next();
      expect(step3.done).toBe(false);
      expect((step3.value as any)?.type).toBe('FORK');
    });
  });

  describe('retroactiveMountCheckSaga', () => {
    it('returns early when no active workspace', () => {
      selectActiveWorkspaceIdMock.mockReturnValue(null);
      const iterator = retroactiveMountCheckSaga();
      iterator.next(); // select
      const result = iterator.next(null);
      expect(result.done).toBe(true);
    });

    it('returns early for optimistic workspace IDs', () => {
      selectActiveWorkspaceIdMock.mockReturnValue('optimistic-abc');
      const iterator = retroactiveMountCheckSaga();
      iterator.next(); // select
      const result = iterator.next('optimistic-abc');
      expect(result.done).toBe(true);
    });

    it('forks mount handler when workspace is active but not yet tracked', () => {
      selectActiveWorkspaceIdMock.mockReturnValue('ws-already-mounted');
      const iterator = retroactiveMountCheckSaga();
      iterator.next(); // select
      const forkEffect = iterator.next('ws-already-mounted');
      expect(forkEffect.done).toBe(false);
      expect((forkEffect.value as any)?.type).toBe('FORK');
      expect((forkEffect.value as any)?.payload?.args?.[0]).toEqual(
        workspaceMounted('ws-already-mounted'),
      );
    });
  });

  describe('fetchAndDispatchSnapshot', () => {
    it('dispatches setSubscriptionSnapshot on successful IPC call', () => {
      invokeMock.mockResolvedValue({
        success: true,
        data: [{ id: 's1', agentId: AGENT, eventTypes: ['file:*'], actorIds: [], createdAt: '', description: '' }],
        delegationGroups: [],
        agentStatuses: {},
      });

      const iterator = fetchAndDispatchSnapshot(WS, AGENT);

      // call invoke
      const callEffect = iterator.next();
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
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // call invoke

      // Simulate error
      const result = iterator.throw?.(new Error('IPC error'));
      // Should complete without throwing
      expect(result?.done).toBe(true);
    });

    it('does not dispatch when result is not successful', () => {
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // call invoke

      // Simulate unsuccessful response
      const result = iterator.next({ success: false });
      expect(result.done).toBe(true);
    });

    it('sets waitingState to idle when no subscriptions or delegation groups', () => {
      const iterator = fetchAndDispatchSnapshot(WS, AGENT);
      iterator.next(); // call invoke

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
  });
});

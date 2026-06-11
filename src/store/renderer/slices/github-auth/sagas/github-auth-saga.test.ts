import { describe, expect, it, vi } from 'vitest';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor, ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

import {
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  initializeGitHubAuth,
  logoutGitHub,
  refreshGitHubAuth,
  startGitHubAuth,
} from '../github-auth-slice';
import { githubAuthSaga } from './github-auth-saga';

function expectWatcher(
  effect: unknown,
  helper: 'takeEvery' | 'takeLatest',
  pattern: unknown,
  workerName: string,
) {
  const worker = (effect as any)?.payload?.args?.[1];

  expect(worker?.name).toBe(workerName);
  expect(effect).toEqual(sagaEffects[helper](pattern as any, worker));
}

describe('githubAuthSaga', () => {
  it('registers latest-only watchers for hydration, auth start, and status checks', () => {
    const iterator = githubAuthSaga();

    expectWatcher(iterator.next().value, 'takeLatest', initializeGitHubAuth, 'handleInitialize');
    expectWatcher(iterator.next().value, 'takeLatest', refreshGitHubAuth, 'handleInitialize');
    expectWatcher(iterator.next().value, 'takeLatest', startGitHubAuth, 'handleStartAuth');
    expectWatcher(
      iterator.next().value,
      'takeLatest',
      checkGitHubAuthStatus,
      'handleCheckAuthStatus',
    );

    expectWatcher(iterator.next().value, 'takeEvery', cancelGitHubAuth, 'handleCancelAuth');
    expectWatcher(iterator.next().value, 'takeEvery', logoutGitHub, 'handleLogout');
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

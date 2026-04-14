import { describe, expect, it, vi } from 'vitest';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
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
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));

import { invoke } from '$lib/electron-bridge';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import {
  fetchProviderUserInfoComplete,
  fetchProviderUserInfoRequested,
  fetchProviderUserInfoSuccess,
} from '../agent-availability-slice';
import { selectProviderStatusMap } from '../agent-availability-selectors';
import { handleFetchProviderUserInfo } from './agent-availability-saga';

describe('handleFetchProviderUserInfo', () => {
  it('fetches provider info even though the trigger already marked loading', () => {
    const providerId = 'auggie';
    const status = { available: true, authenticated: true };
    const iterator = handleFetchProviderUserInfo(fetchProviderUserInfoRequested(providerId));

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(invoke, PROVIDERS_CHANNELS.CHECK_SINGLE, providerId),
      done: false,
    });

    expect(iterator.next({ success: true, providerId, data: status })).toEqual({
      value: sagaEffects.select(selectProviderStatusMap.select),
      done: false,
    });

    expect(iterator.next({ [providerId]: { available: true } })).toEqual({
      value: sagaEffects.put(fetchProviderUserInfoSuccess(providerId, status)),
      done: false,
    });

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(fetchProviderUserInfoComplete(providerId)),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});
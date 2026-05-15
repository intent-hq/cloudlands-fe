import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  debounce: function* (ms: any, pattern: any, worker: any) {
    return yield sagaEffects.debounce(ms, pattern, worker);
  },
}));

vi.mock('$lib/store/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: {
    preflightCloneCheck: vi.fn(),
  },
}));

import { workspaceClient } from '$lib/store/slices/workspace/utils/workspace.client';
import {
  checkClonePreflight,
  clearClonePreflight,
  setClonePreflightError,
  setClonePreflightLoading,
  setClonePreflightOk,
} from '../clone-preflight-slice';
import {
  clonePreflightSaga,
  handleCheckClonePreflight,
  isLikelyCompleteGithubUrl,
  PREFLIGHT_DEBOUNCE_MS,
} from './clone-preflight-saga';

describe('isLikelyCompleteGithubUrl', () => {
  it('accepts well-formed https github urls', () => {
    expect(isLikelyCompleteGithubUrl('https://github.com/owner/repo')).toBe(true);
    expect(isLikelyCompleteGithubUrl('https://github.com/owner/repo.git')).toBe(true);
  });

  it('rejects partial input that is still being typed', () => {
    expect(isLikelyCompleteGithubUrl('')).toBe(false);
    expect(isLikelyCompleteGithubUrl('https://github.com/')).toBe(false);
    expect(isLikelyCompleteGithubUrl('https://github.com/owner')).toBe(false);
    expect(isLikelyCompleteGithubUrl('https://github.com/owner/')).toBe(false);
  });

  it('rejects non-github hosts', () => {
    expect(isLikelyCompleteGithubUrl('https://example.com/owner/repo')).toBe(false);
  });
});

describe('handleCheckClonePreflight', () => {
  it('clears the slice when the URL is incomplete (no IPC call)', () => {
    const iterator = handleCheckClonePreflight(checkClonePreflight('https://github.com/owner'));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearClonePreflight()),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('trims, flips loading, calls the client, and flips ok on success', () => {
    const iterator = handleCheckClonePreflight(
      checkClonePreflight('  https://github.com/owner/repo  '),
    );

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(setClonePreflightLoading('https://github.com/owner/repo')),
      done: false,
    });

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(
        [workspaceClient, workspaceClient.preflightCloneCheck],
        'https://github.com/owner/repo',
      ),
      done: false,
    });

    expect(iterator.next({ ok: true, data: null })).toEqual({
      value: sagaEffects.put(setClonePreflightOk('https://github.com/owner/repo')),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('flips to error on an unsuccessful service response', () => {
    const iterator = handleCheckClonePreflight(
      checkClonePreflight('https://github.com/owner/repo'),
    );

    iterator.next();
    iterator.next();

    expect(iterator.next({ ok: false, error: 'Repository not found' })).toEqual({
      value: sagaEffects.put(
        setClonePreflightError('https://github.com/owner/repo', 'Repository not found'),
      ),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('handles thrown IPC errors by dispatching a friendly error', () => {
    const iterator = handleCheckClonePreflight(
      checkClonePreflight('https://github.com/owner/repo'),
    );

    iterator.next();
    iterator.next();

    expect(iterator.throw(new Error('boom'))).toEqual({
      value: sagaEffects.put(
        setClonePreflightError('https://github.com/owner/repo', 'boom'),
      ),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

describe('clonePreflightSaga', () => {
  it('wires a debounce against checkClonePreflight', () => {
    const iterator = clonePreflightSaga();

    const first = iterator.next().value as any;
    expect(first.type).toBe('FORK');
    expect(first.payload.args?.[0]).toBe(PREFLIGHT_DEBOUNCE_MS);
    expect(first.payload.args?.[1]).toBe(checkClonePreflight.type);
    expect(first.payload.args?.[2]).toBe(handleCheckClonePreflight);

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

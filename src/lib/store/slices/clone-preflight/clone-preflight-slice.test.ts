import { describe, expect, it } from 'vitest';
import {
  clearClonePreflight,
  clonePreflightReducer,
  initialState,
  setClonePreflightError,
  setClonePreflightLoading,
  setClonePreflightOk,
} from './clone-preflight-slice';

describe('clonePreflightReducer', () => {
  it('returns the initial state', () => {
    expect(clonePreflightReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('records the url and flips to loading, clearing any stale error', () => {
    const previous = {
      ...initialState,
      status: 'error' as const,
      url: 'https://github.com/old/old',
      error: 'stale error',
    };

    const next = clonePreflightReducer(
      previous,
      setClonePreflightLoading('https://github.com/owner/repo'),
    );

    expect(next).toEqual({
      status: 'loading',
      url: 'https://github.com/owner/repo',
      error: null,
    });
  });

  it('transitions loading → ok and clears any error', () => {
    const loading = {
      ...initialState,
      status: 'loading' as const,
      url: 'https://github.com/owner/repo',
      error: null,
    };

    const next = clonePreflightReducer(
      loading,
      setClonePreflightOk('https://github.com/owner/repo'),
    );

    expect(next).toEqual({
      status: 'ok',
      url: 'https://github.com/owner/repo',
      error: null,
    });
  });

  it('transitions loading → error carrying the service message', () => {
    const loading = {
      ...initialState,
      status: 'loading' as const,
      url: 'https://github.com/owner/repo',
    };

    const next = clonePreflightReducer(
      loading,
      setClonePreflightError(
        'https://github.com/owner/repo',
        'This repository requires authentication.',
      ),
    );

    expect(next).toEqual({
      status: 'error',
      url: 'https://github.com/owner/repo',
      error: 'This repository requires authentication.',
    });
  });

  it('resets back to the initial state on clear', () => {
    const populated = {
      status: 'error' as const,
      url: 'https://github.com/owner/repo',
      error: 'boom',
    };

    expect(clonePreflightReducer(populated, clearClonePreflight())).toEqual(initialState);
  });
});

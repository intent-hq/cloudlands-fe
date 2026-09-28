import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { describe, expect, it, vi } from 'vitest';
import { createAppStoreMock } from './store-mock';

describe('mock Store dispatch contract', () => {
  const request = createAsyncAction<[id: string], string>('test/loadRequested', 'test/load');

  it('returns the async result only after the request instance settles', async () => {
    const dispatch = vi.fn((action) => action);
    const store = createAppStoreMock({ dispatch });
    const action = request('item-1');
    const result = store.dispatch(action);
    expect(result).toBe(action.promise);
    expect(dispatch).toHaveBeenCalledWith(action);

    const completed = vi.fn();
    void result.then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    store.dispatch(action.success('loaded'));
    await expect(result).resolves.toBe('loaded');
    expect(completed).toHaveBeenCalledWith('loaded');
  });

  it('preserves an explicit caller rejection when the handler rejects synchronously', async () => {
    const error = new Error('load failed');
    const store = createAppStoreMock({
      dispatch: (action: ReturnType<typeof request>) => {
        action.failure(error);
        return action;
      },
    });
    await expect(store.dispatch(request('item-1'))).rejects.toBe(error);
  });

  it('keeps ordinary dispatch results unchanged', () => {
    const action = createAction('test/changed')();
    expect(createAppStoreMock().dispatch(action)).toBe(action);
    const result = { accepted: true };
    const store = createAppStoreMock({ dispatch: () => result });
    expect(store.dispatch(action)).toBe(result);
  });
});

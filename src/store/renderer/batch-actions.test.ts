import { Store } from '@augmentcode/themis/svelte-store';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

import { batchRendererActions, enableRendererActionBatching } from './batch-actions';

const add = createAction<[amount: number]>('counter/add');
const counterReducer = createReducer({ value: 0 });
counterReducer.with(add, (state, { payload: [amount] }) => ({ value: state.value + amount }));

describe('renderer action batching', () => {
  it('publishes only the final state for a multi-action transaction', () => {
    const store = new Store(enableRendererActionBatching({ counter: counterReducer }));
    const dispose = store.init();
    const snapshots: number[] = [];
    const reduxStore = (
      store as unknown as { storeContext: { store: { subscribe(run: () => void): () => void } } }
    ).storeContext.store;
    const unsubscribe = reduxStore.subscribe(() => snapshots.push(store.state.counter.value));

    try {
      store.dispatch(batchRendererActions([add(1), add(2)]));

      expect(store.state.counter.value).toBe(3);
      expect(snapshots).toEqual([3]);
    } finally {
      unsubscribe();
      dispose();
    }
  });
});

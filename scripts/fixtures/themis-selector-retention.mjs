import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import { readable, writable } from 'svelte/store';
import { StoreRuntime } from '../../node_modules/@augmentcode/themis/dist/store-runtime.js';
import { createSelector } from '../../node_modules/@augmentcode/themis/dist/utils/svelte-selectors/create-selector.js';
import {
  evictSelectorOutputsForStateSource,
  getOrCreate,
} from '../../node_modules/@augmentcode/themis/dist/utils/selector-core/selector-output-cache.js';

// Exercise the installed package in a fresh GC-enabled process, not Vitest's
// mocks or heap. Regression: https://github.com/intent-hq/intent/issues/4596.
function createStore() {
  const initialState = { value: 0, payload: [] };
  const reducer = (state = initialState, action) =>
    action.type === 'retention/replace' ? action.payload : state;
  reducer.initialState = initialState;
  const store = new StoreRuntime({ probe: reducer });
  store.init();
  return store;
}

function replace(store, value, payload = []) {
  store.dispatch({ type: 'retention/replace', payload: { value, payload } });
}

async function collect() {
  // WeakRef.deref pins a target until the end of the current job. Cross job
  // boundaries before every collection; allow finalization callbacks to run.
  for (let i = 0; i < 8; i++) {
    await nextTurn();
    global.gc();
  }
  await nextTurn();
}

for (const subscribe of [false, true]) {
  test(`releases historical snapshots after ${subscribe ? 'unsubscribe' : 'unused creation'}`, async () => {
    const store = createStore();
    const select = createSelector(store, (state, id) => state.probe.value + id.length);
    const snapshots = [];
    const visit = (i) => {
      replace(store, i, Array(32768).fill(i));
      snapshots.push(new WeakRef(store.state));
      const output = select.withStore(store)(`agent-${i}`);
      if (subscribe) output.subscribe(() => {})();
    };
    try {
      for (let i = 0; i < 80; i++) visit(i);
      replace(store, -1);
      await collect();
      const retained = snapshots.filter((ref) => ref.deref()).length;
      assert.ok(retained <= 1, `retained ${retained}/80 obsolete state snapshots`);
    } finally {
      store.dispose();
    }
  });
}

test('active subscriptions preserve shared output identity through partial unsubscribe', async () => {
  const store = createStore();
  const select = createSelector(store, (state) => state.probe.value);
  let firstStop;
  let lastStop;
  const subscribe = () => {
    const output = select.withStore(store)('agent');
    firstStop = output.subscribe(() => {});
    lastStop = output.subscribe(() => {});
    return new WeakRef(output);
  };
  const outputRef = subscribe();
  try {
    await collect();
    assert.ok(outputRef.deref(), 'an active subscriber must keep its shared output alive');
    assert.equal(select.withStore(store)('agent'), outputRef.deref());
    firstStop();
    firstStop = undefined;
    await collect();
    assert.ok(outputRef.deref(), 'one remaining subscriber still owns the output');
    assert.equal(select.withStore(store)('agent'), outputRef.deref());
    lastStop();
    lastStop = undefined;
    await collect();
    assert.equal(outputRef.deref(), undefined, 'the cache must not own an inactive output');
  } finally {
    firstStop?.();
    lastStop?.();
    store.dispose();
  }
});

test('held readables resubscribe with fresh state and readable arguments', () => {
  const store = createStore();
  const arg = writable(2);
  const select = createSelector(store, (state, multiplier) => state.probe.value * multiplier);
  const output = select.withStore(store)(arg);
  let stop;
  try {
    replace(store, 3);
    const values = [];
    stop = output.subscribe((value) => values.push(value));
    assert.equal(values.at(-1), 6);
    arg.set(4);
    assert.equal(values.at(-1), 12);
    stop();
    replace(store, 5);
    arg.set(6);
    stop = output.subscribe((value) => values.push(value));
    assert.equal(values.at(-1), 30);
    assert.equal(select.withStore(store)(arg), output);
  } finally {
    stop?.();
    store.dispose();
  }
});

test('store disposal releases abandoned active readables without evicting another store', async () => {
  const disposed = createStore();
  const live = createStore();
  const select = createSelector(disposed, (state) => state.probe.value);
  replace(disposed, 1, Array(131072).fill(1));
  const abandon = (store) => {
    const output = select.withStore(store)('agent');
    output.subscribe(() => {});
    return new WeakRef(output);
  };
  const disposedOutput = abandon(disposed);
  const liveOutput = abandon(live);
  disposed.dispose();
  try {
    await collect();
    assert.equal(disposedOutput.deref(), undefined);
    assert.ok(liveOutput.deref(), 'disposing one store must not unpin another');
    assert.equal(select.withStore(live)('agent'), liveOutput.deref());
  } finally {
    live.dispose();
  }
});

test('a retained unsubscribe cannot pin sibling outputs after store disposal', async () => {
  const store = createStore();
  const select = createSelector(store, (state) => state.probe.value);
  const stop = select('held').subscribe(() => {});
  const abandon = () => {
    const output = select('abandoned');
    output.subscribe(() => {});
    return new WeakRef(output);
  };
  const abandoned = abandon();
  store.dispose();
  try {
    await collect();
    assert.equal(abandoned.deref(), undefined);
  } finally {
    stop();
  }
});

test('weak argument keys do not become strong through cache cleanup bookkeeping', async () => {
  const store = createStore();
  const select = createSelector(store, (state, id) => state.probe.value + id.length);
  const visit = () => {
    const arg = readable('agent');
    select
      .withStore(store)(arg)
      .subscribe(() => {})();
    return new WeakRef(arg);
  };
  try {
    const argRef = visit();
    await collect();
    assert.equal(argRef.deref(), undefined);
  } finally {
    store.dispose();
  }
});

test('cache preserves tuple identity, primitive outputs, and explicit source eviction', () => {
  const source = {};
  const selector = () => {};
  const cache = (args, factory) =>
    getOrCreate(source, selector, args, factory, { weakOutputs: true });
  let calls = 0;
  const factory = () => ({ generation: ++calls });
  const prefix = cache(['agent'], factory);
  const child = cache(['agent', 'tab'], factory);
  const other = cache(['other'], factory);
  assert.equal(cache(['agent'], factory), prefix);
  assert.equal(cache(['agent', 'tab'], factory), child);
  assert.notEqual(other, child);
  assert.equal(calls, 3);
  for (const value of [undefined, null, false, 0, 'text']) {
    assert.equal(
      cache([value], () => value),
      value,
    );
    assert.equal(cache([value], factory), value);
  }
  evictSelectorOutputsForStateSource(source);
  assert.notEqual(cache(['agent'], factory), prefix);
});

test('collected weak outputs release primitive trie keys, not just their payload', async () => {
  const source = {};
  const selector = () => {};
  const visit = () => {
    // Unregistered symbols are primitive Map keys but can themselves be weakly
    // observed. This checks reclamation without exposing cache implementation.
    const key = Symbol('temporary-view');
    getOrCreate(source, selector, ['workspace', key], () => ({}), { weakOutputs: true });
    return new WeakRef(key);
  };
  const keyRef = visit();
  await collect();
  assert.equal(keyRef.deref(), undefined, 'collected entries must not leave primitive keys behind');
});

test('other adapters retain their existing strong-cache behavior unless opted in', async () => {
  const source = {};
  const selector = () => {};
  const cache = () => getOrCreate(source, selector, ['agent'], () => ({}));
  const outputRef = new WeakRef(cache());
  await collect();
  assert.ok(outputRef.deref());
  assert.equal(cache(), outputRef.deref());
  evictSelectorOutputsForStateSource(source);
});

test('delayed finalizers preserve replacements, live descendants, and new source generations', async () => {
  const NativeRegistry = global.FinalizationRegistry;
  let finalize;
  const pending = [];
  global.FinalizationRegistry = class {
    constructor(callback) {
      finalize = callback;
    }
    register(target, holdings) {
      pending.push({ target: new WeakRef(target), holdings });
    }
  };
  let delayedCache;
  try {
    delayedCache =
      await import('../../node_modules/@augmentcode/themis/dist/utils/selector-core/selector-output-cache.js?delayed-finalizers');
  } finally {
    global.FinalizationRegistry = NativeRegistry;
  }
  const source = {};
  const selector = () => {};
  const cache = (...args) =>
    delayedCache.getOrCreate(source, selector, args, () => ({}), { weakOutputs: true });
  const old = new WeakRef(cache('workspace'));
  const child = cache('workspace', 'agent');
  await collect();
  assert.equal(old.deref(), undefined);
  const replacement = cache('workspace');
  const flush = () => {
    for (const entry of pending.splice(0)) {
      if (entry.target.deref()) pending.push(entry);
      else finalize(entry.holdings);
    }
  };
  flush();
  assert.equal(cache('workspace'), replacement);
  assert.equal(cache('workspace', 'agent'), child);

  cache('departing');
  delayedCache.evictSelectorOutputsForStateSource(source);
  const newGeneration = cache('departing');
  await collect();
  flush();
  assert.equal(cache('departing'), newGeneration);
});

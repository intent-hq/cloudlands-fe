import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { viteHarnessCacheDir } from '../test/vite-harness-cache.mjs';

test('workers of one harness own distinct stable caches, including overrides', () => {
  for (const override of [undefined, '.cache/custom']) {
    const options = { root: '/checkout', override };
    const first = viteHarnessCacheDir('strip', { ...options, workerIndex: 0 });
    const second = viteHarnessCacheDir('strip', { ...options, workerIndex: 1 });
    assert.notEqual(first, second);
    assert.equal(first, viteHarnessCacheDir('strip', { ...options, workerIndex: 0 }));
    assert.equal(path.dirname(first), viteHarnessCacheDir('strip', options));
  }
});

test('legacy names and explicit overrides retain their existing paths', () => {
  assert.equal(
    viteHarnessCacheDir('strip', { root: '/checkout' }),
    '/checkout/node_modules/.vite-harness/strip',
  );
  assert.equal(
    viteHarnessCacheDir('strip', { root: '/checkout', override: '.cache/custom' }),
    '/checkout/.cache/custom',
  );
  assert.notEqual(viteHarnessCacheDir('strip'), viteHarnessCacheDir('sidebar'));
});

test('invalid worker identities cannot escape or alias a cache', () => {
  for (const workerIndex of [-1, 0.5, NaN, Infinity, '0', '../other']) {
    assert.throws(() => viteHarnessCacheDir('strip', { workerIndex }), /workerIndex/);
  }
  assert.throws(() => viteHarnessCacheDir('../other', { workerIndex: 0 }), /harness name/);
});

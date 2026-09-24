import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createRequestPacer } from '../src/request-pacing.ts';

test('spaces concurrent starts and extends already queued work after a cooldown', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pacer = createRequestPacer(1000);
  const starts: number[] = [];
  const jobs = [1, 2, 3].map(async () => {
    await pacer.wait();
    starts.push(Date.now());
  });
  await setImmediate();
  assert.deepEqual(starts, [10_000]);
  t.mock.timers.tick(999);
  await setImmediate();
  assert.equal(starts.length, 1);
  pacer.defer(5000);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(4999);
  await setImmediate();
  assert.deepEqual(starts, [10_000, 15_999]);
  t.mock.timers.tick(1000);
  await Promise.all(jobs);
  assert.deepEqual(starts, [10_000, 15_999, 16_999]);
});

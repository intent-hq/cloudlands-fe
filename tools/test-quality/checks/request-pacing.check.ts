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

test('reconciles successful usage and limits concurrent reservations in a rolling second', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pacer = createRequestPacer(0, 125_000);
  const first = await pacer.wait(65_536);
  first(30_000);
  await pacer.wait(65_536);
  let thirdStarted = false;
  const third = pacer.wait(65_536).then(() => {
    thirdStarted = true;
  });
  await setImmediate();
  assert.equal(thirdStarted, false);
  t.mock.timers.tick(999);
  await setImmediate();
  assert.equal(thirdStarted, false);
  t.mock.timers.tick(1);
  await third;
  assert.equal(thirdStarted, true);
});

test('unknown usage retains the full reservation and retries also consume the budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pacer = createRequestPacer(100, 125_000);
  await pacer.wait(65_536);
  const starts: number[] = [];
  const retry = pacer.wait(65_536).then(() => starts.push(Date.now()));
  await setImmediate();
  t.mock.timers.tick(100);
  await setImmediate();
  assert.deepEqual(starts, []);
  t.mock.timers.tick(900);
  await retry;
  assert.deepEqual(starts, [11_000]);
});

test('rejects requests and reported usage exceeding their reserved budgets', async () => {
  const pacer = createRequestPacer(0, 125_000);
  await assert.rejects(pacer.wait(125_001), /exceeds the input token rate budget/);
  const recordUsage = await pacer.wait(65_536);
  assert.throws(() => recordUsage(65_537), /exceeded the reserved context limit/);
});

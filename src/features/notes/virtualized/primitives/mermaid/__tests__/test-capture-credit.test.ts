import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const {
  createCaptureCredit,
  defaultCaptureLimits,
  captureCreditCost,
} = require('./test-capture-credit.cjs');
const { creditStore } = require('./test-credited-store.cjs');
const { createTestPaintStore } = require('./test-paint-store.cjs');
it('refuses before capture starts and retains another owner credit', () => {
  const credit = createCaptureCredit({ ...defaultCaptureLimits, pendingCaptures: 1 });
  const cost = captureCreditCost({ width: 256, height: 64 }, 2, true);
  const first = credit.reserve('first', cost);
  expect(cost.nativeImageBytes).toBe(1310720);
  expect(cost.bitmapBytes).toBe(1310720);
  expect(() => credit.reserve('second', cost)).toThrow('credit refused');
  expect(credit.inspect().live.nativeImageBytes).toBe(1310720);
  first.release();
  first.release();
  expect(credit.inspect().live.pendingCaptures).toBe(0);
});
it('reserves pending disk/index bytes before a held write and retains actual durable bytes afterward', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mermaid-credit-'));
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const block = new Promise<void>((r) => {
    release = r;
  });
  const credit = createCaptureCredit(defaultCaptureLimits);
  const raw = await createTestPaintStore(root, {
    beforeDataWrite: async () => {
      entered();
      await block;
    },
  });
  const store = creditStore(raw, credit, 'owner');
  try {
    const pending = store.append('tile', { data: 'actual' });
    await ready;
    expect(credit.inspect().live).toMatchObject({
      pendingWrites: 1,
      storageBytes: 12288,
      indexBytes: 12,
      encodedBytes: 61452,
    });
    await expect(store.abort()).rejects.toThrow('physically settle');
    expect(credit.inspect().live.pendingWrites).toBe(1);
    release();
    await pending;
    expect(credit.inspect().live).toMatchObject({
      pendingWrites: 0,
      storageBytes: 17,
      indexBytes: 12,
      encodedBytes: 0,
    });
    await store.seal({ sourceRef: 'test' });
    expect(credit.inspect().live.manifestBytes).toBeGreaterThan(0);
    await store.abort();
    expect(Object.values(credit.inspect().live).every((x) => x === 0)).toBe(true);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});
it('storage refusal does not start a write or consume marker budget', async () => {
  const credit = createCaptureCredit({ ...defaultCaptureLimits, storageBytes: 0 });
  let calls = 0;
  const store = creditStore(
    {
      append: async () => {
        calls++;
      },
    },
    credit,
    'owner',
  );
  await expect(store.append('tile', { data: 'x' })).rejects.toThrow('credit refused');
  expect(calls).toBe(0);
  expect(credit.inspect().live.markerBytes).toBe(0);
});

it('keeps failed partial-file reservations until cleanup settles', async () => {
  const credit = createCaptureCredit(defaultCaptureLimits);
  let deleted = false;
  const store = creditStore(
    {
      append: async () => {
        throw new Error('partial disk failure');
      },
      abort: async () => {
        deleted = true;
      },
    },
    credit,
    'failed-owner',
  );
  await expect(store.append('tile', { data: 'x' })).rejects.toThrow('partial disk failure');
  expect(credit.inspect().live).toMatchObject({
    pendingWrites: 0,
    storageBytes: 12288,
    indexBytes: 12,
  });
  expect(deleted).toBe(false);
  await store.abort();
  expect(deleted).toBe(true);
  expect(credit.inspect().live.storageBytes).toBe(0);
});

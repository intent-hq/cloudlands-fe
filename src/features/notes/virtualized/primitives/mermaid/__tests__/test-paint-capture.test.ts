import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { captureIntoPrivateStore } = createRequire(import.meta.url)('./test-paint-capture.cjs');
it('retains actual capture ownership through cancellation and never persists cancelled output', async () => {
  let resolve!: (value: unknown) => void;
  const capture = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = new AbortController();
  const store = { append: vi.fn() };
  let settled = false;
  const pending = captureIntoPrivateStore({
    capture,
    store,
    signal: controller.signal,
    marker: { clip: { x: 0, y: 0, width: 256, height: 20 }, dpr: 1 },
  });
  const observed = pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  resolve({});
  await observed;
  expect(settled).toBe(true);
  expect(store.append).not.toHaveBeenCalled();
});
it('chunks encoded tiles independently of decoded bitmap size', async () => {
  const writes: { kind: string; value: unknown }[] = [];
  const append = vi.fn(async (kind, value) => {
    writes.push({ kind, value });
    return writes.length - 1;
  });
  const result = await captureIntoPrivateStore({
    capture: async () => ({
      getSize: () => ({ width: 256, height: 20 }),
      toBitmap: () => Buffer.alloc(20480),
      toPNG: () => Buffer.alloc(15000),
    }),
    store: { append },
    signal: new AbortController().signal,
    marker: { clip: { x: 0, y: 0, width: 256, height: 20 }, dpr: 1 },
  });
  expect(result).toEqual({ pngBytes: 15000, decodedBytes: 20480, chunks: 3 });
  expect(writes.filter((x) => x.kind === 'tile-chunk')).toHaveLength(3);
  expect(writes.every((x) => Buffer.byteLength(JSON.stringify(x.value)) < 12288)).toBe(true);
});

it('holds append ownership through cancellation while a real disk write is scheduled', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createTestPaintStore, openTestPaintReader } = createRequire(import.meta.url)(
    './test-paint-store.cjs',
  );
  const root = await mkdtemp(join(tmpdir(), 'diff-cancelled-disk-'));
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((done) => {
    release = done;
  });
  const writing = new Promise<void>((done) => {
    entered = done;
  });
  const store = await createTestPaintStore(root, {
    beforeDataWrite: async () => {
      entered();
      await barrier;
    },
  });
  const signal = new AbortController();
  let settled = false;
  const pending = captureIntoPrivateStore({
    capture: async () => ({
      getSize: () => ({ width: 256, height: 20 }),
      toBitmap: () => Buffer.alloc(20480),
      toPNG: () => Buffer.alloc(7000),
    }),
    store,
    signal: signal.signal,
    marker: { clip: { x: 0, y: 0, width: 256, height: 20 }, dpr: 1 },
  });
  const observed = pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await writing;
    signal.abort();
    await expect(store.abort()).rejects.toThrow('physically settle');
    expect(settled).toBe(false);
    release();
    await observed;
    expect(settled).toBe(true);
    expect((await readFile(join(root, 'tile-chunk.data'))).length).toBeGreaterThan(0);
    await expect(openTestPaintReader(root)).rejects.toThrow();
    await store.abort();
    await expect(readFile(join(root, 'tile-chunk.data'))).rejects.toThrow();
  } finally {
    release();
    await observed;
    await store.abort();
    await rm(root, { recursive: true, force: true });
  }
});

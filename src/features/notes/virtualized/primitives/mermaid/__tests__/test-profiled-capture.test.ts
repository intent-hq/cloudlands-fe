import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { captureIntoPrivateStore } = createRequire(import.meta.url)('./test-profiled-capture.cjs');
it('budgets physical DPR2 dimensions and persists bounded encoded chunks', async () => {
  const records: any[] = [];
  const result = await captureIntoPrivateStore({
    capture: async () => ({
      getSize: () => ({ width: 512, height: 128 }),
      toBitmap: () => Buffer.alloc(262144),
      toPNG: () => Buffer.alloc(19000),
    }),
    store: {
      append: async (kind: string, value: unknown) => {
        records.push({ kind, value });
        return records.length - 1;
      },
    },
    marker: { clip: { x: 0, y: 0, width: 256, height: 64 }, dpr: 2 },
    signal: new AbortController().signal,
  });
  expect(result.decodedBytes).toBe(262144);
  expect(result.chunks).toBe(4);
  expect(records.slice(0, 4).every((r) => r.value.base64.length <= 8192)).toBe(true);
  expect(records[4].value.size).toEqual({ width: 512, height: 128 });
});
it('rejects mismatched returned physical scale without writing', async () => {
  let writes = 0;
  await expect(
    captureIntoPrivateStore({
      capture: async () => ({ getSize: () => ({ width: 256, height: 64 }) }),
      store: {
        append: async () => {
          writes++;
        },
      },
      marker: { clip: { x: 0, y: 0, width: 256, height: 64 }, dpr: 2 },
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('Capture profile mismatch');
  expect(writes).toBe(0);
});

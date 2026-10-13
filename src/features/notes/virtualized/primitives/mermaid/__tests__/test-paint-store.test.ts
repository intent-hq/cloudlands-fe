import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { createTestPaintStore, openTestPaintReader, RECORD_BYTES, PAGE_BYTES } = createRequire(
  import.meta.url,
)('./test-paint-store.cjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'diff-test-index-'));
  roots.push(root);
  return { root, store: await createTestPaintStore(root) };
}
it('reopens sealed records and seeks without loading preceding records', async () => {
  const { root, store } = await setup();
  for (let index = 0; index < 100; index++)
    await store.append('text', { index, text: '界🙂'.repeat(30) });
  await store.seal({ sourceRef: 'test-only-frozen-owner' });
  const reader = await openTestPaintReader(root);
  const page = await reader.read('text', 97, 2);
  expect(page.records.map((r: { index: number }) => r.index)).toEqual([97, 98]);
  expect(page.indexBytes).toBe(24);
  expect(page.next).toBe(99);
  expect(page.done).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(PAGE_BYTES);
  expect((await reader.read('text', 99)).done).toBe(true);
});
it('caps encoded records and complete pages independently', async () => {
  const { root, store } = await setup();
  await expect(store.append('text', { text: 'x'.repeat(RECORD_BYTES) })).rejects.toThrow('budget');
  for (let i = 0; i < 3; i++) await store.append('text', { text: 'x'.repeat(9000) });
  await store.seal({ sourceRef: 'test' });
  const page = await (await openTestPaintReader(root)).read('text', 0);
  expect(page.records).toHaveLength(1);
  expect(page.next).toBe(1);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(PAGE_BYTES);
});
it('never exposes unsealed or aborted output', async () => {
  const { root, store } = await setup();
  await store.append('caret', { offset: 0 });
  await expect(openTestPaintReader(root)).rejects.toThrow();
  await store.abort();
  await expect(openTestPaintReader(root)).rejects.toThrow();
});

import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createTestPaintStore, openTestPaintReader } = require('./test-paint-store.cjs');
const { queryStoredViewport } = require('./test-spatial-store.cjs');
it('queries unselected world rectangles from a sealed spatial index and rejects changed bindings before reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mermaid-spatial-'));
  try {
    const store = await createTestPaintStore(root);
    const binding = {
      sourceRef: 'canonical-test-ref',
      revision: 'r1',
      theme: 'dark',
      font: 'resolved-font',
      dpr: 2,
      zoom: 2,
    };
    for (let row = 0; row < 4; row++)
      await store.append('spatial-cell', { binding, row, column: 0, tile: row + 7 });
    await store.seal(binding);
    const disk = await openTestPaintReader(root);
    let reads = 0;
    const reader = {
      read: async (...args: any[]) => {
        reads++;
        return disk.read(...args);
      },
    };
    const descriptor = {
      binding,
      firstCell: 0,
      grid: { x: 10000, y: 20000, width: 128, height: 128, rows: 4, columns: 1 },
    };
    expect(
      (
        await queryStoredViewport(reader, descriptor, binding, {
          x: 10011,
          y: 20017,
          width: 80,
          height: 40,
        })
      ).cells.map((c: any) => c.tile),
    ).toEqual([7, 8]);
    expect(
      (
        await queryStoredViewport(reader, descriptor, binding, {
          x: 10020,
          y: 20096,
          width: 80,
          height: 32,
        })
      ).cells.map((c: any) => c.tile),
    ).toEqual([10]);
    expect(reads).toBe(3);
    for (const replacement of [
      { theme: 'light' },
      { font: 'other' },
      { dpr: 1 },
      { zoom: 1 },
      { revision: 'r2' },
      { sourceRef: 'other' },
    ])
      await expect(
        queryStoredViewport(
          reader,
          descriptor,
          { ...binding, ...replacement },
          { x: 10011, y: 20017, width: 80, height: 40 },
        ),
      ).rejects.toThrow('Stale spatial binding');
    expect(reads).toBe(3);
    await expect(
      queryStoredViewport(reader, descriptor, binding, {
        x: 9999,
        y: 20000,
        width: 80,
        height: 40,
      }),
    ).rejects.toThrow('outside captured coverage');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

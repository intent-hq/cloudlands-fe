import { expect, it } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { comparePersistedOracle, readPersistedPage } from './electron-persisted-read';
const { createTestPaintStore, openTestPaintReader } = createRequire(import.meta.url)(
  './test-paint-store.cjs',
);

// Explicit TEST DOUBLE of Electron-first evaluate dispatch; no Electron/runtime proof.
const app = {
  evaluate: async (callback: (...args: any[]) => unknown, argument: unknown) =>
    callback({ BrowserWindow: {} }, argument),
} as unknown as ElectronApplication;

it('rejects the old callback shape and reads the requested persisted tile and chunk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mermaid-electron-query-'));
  try {
    const store = await createTestPaintStore(root);
    await store.append('tile', { ordinal: 0 });
    await store.append('tile', { ordinal: 1 });
    await store.append('tile-chunk', { base64: 'Y2Fmw6k=' });
    await store.seal({ sourceRef: 'test-only' });
    Object.assign(globalThis, { persistedPaint: await openTestPaintReader(root) });
    await expect(
      app.evaluate(({ at }: any) => (globalThis as any).persistedPaint.read('tile', at, 1), {
        at: 1,
      }),
    ).rejects.toThrow('Invalid private artifact query');
    await expect(
      app.evaluate((at: any) => (globalThis as any).persistedPaint.read('tile-chunk', at, 1), 0),
    ).rejects.toThrow('Invalid private artifact query');
    const page = await readPersistedPage(app, 'tile', 1, 1);
    expect(page.records).toEqual([{ ordinal: 1 }]);
    expect(page.indexBytes).toBe(12);
    expect(page.done).toBe(true);
    expect((await readPersistedPage(app, 'tile-chunk', 0, 1)).records).toEqual([
      { base64: 'Y2Fmw6k=' },
    ]);
  } finally {
    Reflect.deleteProperty(globalThis, 'persistedPaint');
    await rm(root, { recursive: true, force: true });
  }
});

it('passes the selected camera to the private oracle after the Electron argument', async () => {
  // Independent dispatch oracle, not a substitute for pixel comparison.
  Object.assign(globalThis, {
    persistedPaint: {
      compareOracle(camera: number) {
        if (camera !== 0 && camera !== 1) throw new Error('Invalid oracle camera');
        return camera === 0 ? 'native-1x' : 'native-2x';
      },
    },
  });
  try {
    await expect(
      app.evaluate((camera: any) => (globalThis as any).persistedPaint.compareOracle(camera), 1),
    ).rejects.toThrow('Invalid oracle camera');
    expect(await comparePersistedOracle(app, 0)).toBe('native-1x');
    expect(await comparePersistedOracle(app, 1)).toBe('native-2x');
  } finally {
    Reflect.deleteProperty(globalThis, 'persistedPaint');
  }
});

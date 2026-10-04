import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { comparePersistedOracle, readPersistedPage } from './electron-persisted-read';
const owned = 'src/features/notes/virtualized/primitives/mermaid/__tests__';
const evidence = resolve(process.env.MERMAID_PERSISTED_EVIDENCE ?? 'missing-explicit-evidence');
async function launch(
  name: string,
  source: string,
  options: {
    dark: boolean;
    holdWrite?: boolean;
    dpr?: number;
    creditLimits?: Record<string, number>;
  },
) {
  if (!process.env.MERMAID_PERSISTED_EVIDENCE) throw new Error('Explicit test evidence required');
  const manifest = JSON.parse(await readFile(join(evidence, 'frozen-host-sources.json'), 'utf8'));
  expect(manifest.head).toBe(process.env.MERMAID_FROZEN_HOST_SHA);
  const root = join(evidence, name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'source.txt'), source);
  await writeFile(join(root, 'options.json'), JSON.stringify(options));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        ['PATH', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'SYSTEMROOT'].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    chromiumSandbox: true,
    executablePath: process.env.HOST_ELECTRON,
    args: [
      resolve(owned, 'persisted-mermaid-main.cjs'),
      join(evidence, 'manager/host.cjs'),
      join(evidence, 'renderer'),
      root,
    ],
    env: { ...env, DD_TRACE_ENABLED: 'false' },
  });
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as any).persistedPaintError || !!(globalThis as any).persistedPaint,
      ),
    )
    .toBe(true);
  return { app, root };
}
async function nativePage(app: ElectronApplication, id: number): Promise<Page> {
  let result: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of app.windows()) {
        const window = await app.browserWindow(page);
        try {
          if ((await window.evaluate((w) => w.webContents.id)) === id) result = page;
        } finally {
          await window.dispose();
        }
      }
      return !!result;
    })
    .toBe(true);
  return result!;
}
for (const { dark, kind, dpr } of [
  ...[false, true].flatMap((dark) =>
    ['large-comment', 'large-scene'].map((kind) => ({ dark, kind, dpr: 1 })),
  ),
  { dark: false, kind: 'large-scene', dpr: 2 },
]) {
  test(`persisted native Mermaid ${kind} ${dark ? 'dark' : 'light'} DPR${dpr}`, async () => {
    const code =
      kind === 'large-comment'
        ? '%%' + 'x'.repeat(2000000) + '\nflowchart LR\nA[Start café 世界] -->|boundary| B[Finish]'
        : 'flowchart TB\n' +
          Array.from({ length: 200 }, (_, i) => `N${i}[Node ${i} café]`).join('\n');
    const { app, root } = await launch(kind + '-' + dark + '-dpr' + dpr, code, { dark, dpr });
    try {
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).persistedPaint.state.status), {
          timeout: 50000,
        })
        .not.toBe('pending');
      const initial = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
      await writeFile(join(root, 'retirement.json'), JSON.stringify(initial, null, 2));
      expect(initial.state.status, initial.state.error).toBe('resolved');
      expect(initial.state.retired).toBe(true);
      expect(initial.state.released).toBe(true);
      expect(initial.state.liveCaptures).toBe(0);
      expect(initial.state.peakCaptures).toBe(1);
      expect(initial.state.captureCount).toBe(8);
      expect(initial.state.oracleCount).toBe(2);
      expect(initial.state.maxDecodedBytes).toBe(65536 * dpr * dpr);
      expect(initial.state.maxOracleDecodedBytes).toBe(262144 * dpr * dpr);
      expect(initial.state.conservativeDecodedCopyBytes).toBe(655360 * dpr * dpr);
      expect(initial.manager.active).toBeUndefined();
      expect(initial.manager.retiring).toBe(0);
      const id = await app.evaluate(() => (globalThis as any).persistedPaint.openConsumer());
      const consumer = await nativePage(app, id);
      const samples = [];
      for (const camera of [0, 1, 0]) {
        await consumer.evaluate(() => {
          for (const image of document.images) image.src = '';
          document.body.replaceChildren();
        });
        let decoded = 0,
          encoded = 0;
        for (let band = 0; band < 4; band++) {
          const page = await readPersistedPage(app, 'tile', camera * 4 + band, 1);
          expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16384);
          const tile = page.records[0];
          expect(tile.camera).toBe(camera);
          expect(tile.band).toBe(band);
          expect(tile.identity).toEqual(initial.state.result.identity);
          let base64 = '';
          for (let at = tile.chunkStart; at < tile.chunkStart + tile.chunks; at++) {
            const chunk = await readPersistedPage(app, 'tile-chunk', at, 1);
            expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(16384);
            base64 += chunk.records[0].base64;
          }
          expect(Buffer.from(base64, 'base64').length).toBe(tile.pngBytes);
          expect(tile.pngBytes).toBeLessThanOrEqual(65536 * dpr * dpr);
          await consumer.evaluate(
            async ({ base64, tile, dpr }) => {
              const image = new Image();
              image.style.cssText = `position:absolute;left:0;top:${tile.clip.y}px;display:block;width:256px;height:64px`;
              image.src = 'data:image/png;base64,' + base64;
              await image.decode();
              if (image.naturalWidth !== 256 * dpr || image.naturalHeight !== 64 * dpr)
                throw new Error('Persisted band decode mismatch');
              document.body.append(image);
            },
            { base64, tile, dpr },
          );
          decoded += tile.decodedBytes;
          encoded += tile.pngBytes;
        }
        await consumer.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const comparison = await comparePersistedOracle(app, camera);
        expect(comparison.meanChannelError).toBeLessThanOrEqual(0.5);
        expect(comparison.differentFraction).toBeLessThanOrEqual(0.01);
        expect(decoded).toBe(262144 * dpr * dpr);
        const state = await consumer.evaluate(() => ({
          images: document.images.length,
          svg: document.querySelectorAll('svg').length,
          text: document.body.textContent,
          producer: 'primitiveHost' in window,
        }));
        expect(state).toEqual({ images: 4, svg: 0, text: '', producer: false });
        samples.push({ camera, decoded, encoded, comparison, state });
      }
      // Consumer chooses new rectangles only AFTER constructor retirement; the producer
      // captured a region, not these query coordinates. Coverage is explicitly finite.
      const descriptor = (await readPersistedPage(app, 'spatial-grid', 1, 1)).records[0];
      const spatial = [];
      for (const clip of [
        { x: 13, y: 17, width: 192, height: 144 },
        { x: 27, y: 53, width: 160, height: 128 },
      ]) {
        const rect = {
          x: descriptor.grid.x + clip.x / descriptor.binding.zoom,
          y: descriptor.grid.y + clip.y / descriptor.binding.zoom,
          width: clip.width / descriptor.binding.zoom,
          height: clip.height / descriptor.binding.zoom,
        };
        const query = await app.evaluate(
          (_electron, args) =>
            (globalThis as any).persistedPaint.queryViewport(
              args.descriptor,
              args.binding,
              args.rect,
            ),
          { descriptor, binding: descriptor.binding, rect },
        );
        await consumer.evaluate(() => document.body.replaceChildren());
        for (const cell of query.cells) {
          const tile = (await readPersistedPage(app, 'tile', cell.tile, 1)).records[0];
          let base64 = '';
          for (let at = tile.chunkStart; at < tile.chunkStart + tile.chunks; at++)
            base64 += (await readPersistedPage(app, 'tile-chunk', at, 1)).records[0].base64;
          await consumer.evaluate(
            async ({ base64, tile, clip, dpr }) => {
              const image = new Image();
              image.style.cssText = `position:absolute;left:${tile.clip.x - clip.x}px;top:${tile.clip.y - clip.y}px;width:256px;height:64px`;
              image.src = 'data:image/png;base64,' + base64;
              await image.decode();
              if (image.naturalWidth !== 256 * dpr || image.naturalHeight !== 64 * dpr)
                throw new Error('Spatial decode profile mismatch');
              document.body.append(image);
            },
            { base64, tile, clip, dpr },
          );
        }
        await consumer.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const comparison = await comparePersistedOracle(app, 1, clip);
        expect(comparison.meanChannelError).toBeLessThanOrEqual(0.5);
        expect(comparison.differentFraction).toBeLessThanOrEqual(0.01);
        spatial.push({ rect, clip, cells: query.cells.length, comparison });
      }
      for (const replacement of [
        { zoom: 1 },
        { resolvedFont: 'changed' },
        { dpr: 3 },
        { profile: { ...descriptor.binding.profile, theme: 'changed' } },
        { identity: { ...descriptor.binding.identity, sourceRef: 'changed' } },
      ])
        await expect(
          app.evaluate(
            (_electron, args) =>
              (globalThis as any).persistedPaint.queryViewport(
                args.descriptor,
                args.binding,
                args.rect,
              ),
            {
              descriptor,
              binding: { ...descriptor.binding, ...replacement },
              rect: spatial[0].rect,
            },
          ),
        ).rejects.toThrow('Stale spatial binding');
      const final = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
      await writeFile(
        join(root, 'replay.json'),
        JSON.stringify(
          {
            samples,
            spatial,
            final,
            limitations: [
              'TEST ONLY private artifact',
              'native oracle stays supervisor-only',
              'Measured DPR1 or DPR2 profile; CSS zoom1+2; finite indexed coverage only',
              'no semantic/a11y/interaction/source-map claim',
              'counters are payload/ownership observations, not measured heap',
              'main NativeImage/GPU allocation reclamation is not measured by renderer PID retirement',
              'full-frame oracle stays supervisor-only and is separately charged',
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await app.close();
    }
  });
}
test('cancellation holds append ownership until its pending private write settles', async () => {
  const { app, root } = await launch('cancel-write', 'flowchart LR\nA[Start] --> B[Finish]', {
    dark: false,
    holdWrite: true,
  });
  try {
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).persistedPaint.state.writeHeld), {
        timeout: 50000,
      })
      .toBe(true);
    await app.evaluate(() => (globalThis as any).persistedPaint.cancel());
    const held = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
    expect(held.state.status).toBe('pending');
    expect(held.state.released).toBe(false);
    expect(held.state.liveCaptures).toBe(1);
    expect(held.credit.live.pendingCaptures).toBe(1);
    expect(held.credit.live.pendingWrites).toBe(1);
    expect(held.credit.live.nativeImageBytes).toBeGreaterThan(0);
    expect(held.credit.live.bitmapBytes).toBeGreaterThan(0);
    expect(held.credit.live.oracleBytes).toBeGreaterThan(0);
    await app.evaluate(() => (globalThis as any).persistedPaint.releaseWrite());
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).persistedPaint.state.status))
      .toBe('rejected');
    const final = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
    expect(final.state.retired).toBe(true);
    expect(final.state.released).toBe(true);
    expect(final.state.aborted).toBe(true);
    expect(final.state.liveCaptures).toBe(0);
    expect(Object.values(final.credit.live).every((value) => value === 0)).toBe(true);
    await expect(
      app.evaluate(() => (globalThis as any).persistedPaint.openConsumer()),
    ).rejects.toThrow('not physically ready');
    await writeFile(join(root, 'cancel.json'), JSON.stringify({ held, final }, null, 2));
  } finally {
    await app.close();
  }
});

test('configured capture credits refuse before native capture without restricting product inputs', async () => {
  const { app, root } = await launch('credit-refusal', 'flowchart LR\nA[Start] --> B[Finish]', {
    dark: false,
    creditLimits: { nativeImageBytes: 0 },
  });
  try {
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).persistedPaint.state.status), {
        timeout: 50000,
      })
      .toBe('rejected');
    const result = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
    expect(result.state.error).toContain('credit refused');
    expect(result.state.captureCount).toBe(0);
    expect(result.state.oracleCount).toBe(0);
    expect(result.state.released).toBe(true);
    expect(result.state.retired).toBe(true);
    expect(result.credit.refused).toBe(1);
    expect(Object.values(result.credit.live).every((value) => value === 0)).toBe(true);
    await writeFile(join(root, 'refusal.json'), JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
});

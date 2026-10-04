import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const owned = 'src/features/notes/virtualized/primitives/mermaid/__tests__';
const evidence = resolve(process.env.MERMAID_PERSISTED_EVIDENCE ?? 'missing-explicit-evidence');
async function launch(
  name: string,
  source: string,
  options: { dark: boolean; holdWrite?: boolean },
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
for (const dark of [false, true])
  for (const kind of ['large-comment', 'large-scene']) {
    test(`persisted native Mermaid ${kind} ${dark ? 'dark' : 'light'}`, async () => {
      const code =
        kind === 'large-comment'
          ? '%%' +
            'x'.repeat(2000000) +
            '\nflowchart LR\nA[Start café 世界] -->|boundary| B[Finish]'
          : 'flowchart TB\n' +
            Array.from({ length: 200 }, (_, i) => `N${i}[Node ${i} café]`).join('\n');
      const { app, root } = await launch(kind + '-' + dark, code, { dark });
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
        expect(initial.state.maxDecodedBytes).toBe(65536);
        expect(initial.state.maxOracleDecodedBytes).toBe(262144);
        expect(initial.state.conservativeDecodedCopyBytes).toBe(655360);
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
            const page = await app.evaluate(
              ({ at }) => (globalThis as any).persistedPaint.read('tile', at, 1),
              { at: camera * 4 + band },
            );
            expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16384);
            const tile = page.records[0];
            expect(tile.camera).toBe(camera);
            expect(tile.band).toBe(band);
            expect(tile.identity).toEqual(initial.state.result.identity);
            let base64 = '';
            for (let at = tile.chunkStart; at < tile.chunkStart + tile.chunks; at++) {
              const chunk = await app.evaluate(
                (at) => (globalThis as any).persistedPaint.read('tile-chunk', at, 1),
                at,
              );
              expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(16384);
              base64 += chunk.records[0].base64;
            }
            expect(Buffer.from(base64, 'base64').length).toBe(tile.pngBytes);
            expect(tile.pngBytes).toBeLessThanOrEqual(65536);
            await consumer.evaluate(
              async ({ base64, tile }) => {
                const image = new Image();
                image.style.cssText = `position:absolute;left:0;top:${tile.clip.y}px;display:block`;
                image.src = 'data:image/png;base64,' + base64;
                await image.decode();
                if (image.naturalWidth !== 256 || image.naturalHeight !== 64)
                  throw new Error('Persisted band decode mismatch');
                document.body.append(image);
              },
              { base64, tile },
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
          const comparison = await app.evaluate(
            (camera) => (globalThis as any).persistedPaint.compareOracle(camera),
            camera,
          );
          expect(comparison.meanChannelError).toBeLessThanOrEqual(0.5);
          expect(comparison.differentFraction).toBeLessThanOrEqual(0.01);
          expect(decoded).toBe(262144);
          const state = await consumer.evaluate(() => ({
            images: document.images.length,
            svg: document.querySelectorAll('svg').length,
            text: document.body.textContent,
            producer: 'primitiveHost' in window,
          }));
          expect(state).toEqual({ images: 4, svg: 0, text: '', producer: false });
          samples.push({ camera, decoded, encoded, comparison, state });
        }
        const final = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
        await writeFile(
          join(root, 'replay.json'),
          JSON.stringify(
            {
              samples,
              final,
              limitations: [
                'TEST ONLY private artifact',
                'native oracle stays supervisor-only',
                'DPR1/CSS zoom1+2',
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
    await app.evaluate(() => (globalThis as any).persistedPaint.releaseWrite());
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).persistedPaint.state.status))
      .toBe('rejected');
    const final = await app.evaluate(() => (globalThis as any).persistedPaint.inspect());
    expect(final.state.retired).toBe(true);
    expect(final.state.released).toBe(true);
    expect(final.state.aborted).toBe(true);
    expect(final.state.liveCaptures).toBe(0);
    await expect(
      app.evaluate(() => (globalThis as any).persistedPaint.openConsumer()),
    ).rejects.toThrow('not physically ready');
    await writeFile(join(root, 'cancel.json'), JSON.stringify({ held, final }, null, 2));
  } finally {
    await app.close();
  }
});

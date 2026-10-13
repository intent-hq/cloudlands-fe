import { expect, test } from '../../../../test/ct-test';
import MermaidPaintProbe from './MermaidPaintProbe.svelte';
import type { MermaidPaintProbe as PaintResult } from './mermaid-paint-probe';

for (const dark of [false, true]) {
  for (const kind of ['large-comment', 'large-scene'] as const) {
    test(`compares native Mermaid paint tiles for ${kind} in ${dark ? 'dark' : 'light'} theme`, async ({
      mount,
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      const code =
        kind === 'large-comment'
          ? '%%' +
            'x'.repeat(2_000_000) +
            '\nflowchart LR\nA[Start café 世界] -->|boundary| B[Finish]'
          : 'flowchart TB\n' +
            Array.from({ length: 200 }, (_, i) => `N${i}[Node ${i} café]`).join('\n');
      const component = await mount(MermaidPaintProbe, { props: { code, dark } });
      await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
        'data-render-settled',
        'true',
        { timeout: 15_000 },
      );
      const camera = component;
      for (const scale of [1, 2]) {
        // Exercise both host parities: centering must not introduce a different
        // source raster phase from the standalone image at either zoom.
        await component.getByTestId('native-paint-construction').evaluate((host, width) => {
          (host as HTMLElement).style.width = `${width}px`;
        }, 899 + scale);
        const result = await camera.evaluate(
          (element, scale) =>
            (
              element as HTMLElement & { paint(target: 'far', scale: number): Promise<PaintResult> }
            ).paint('far', scale),
          scale,
        );
        const beforeScreenshot = await camera.evaluate((element) =>
          (element as HTMLElement & { paintSnapshot(phase: string): unknown }).paintSnapshot(
            'before-screenshot',
          ),
        );
        const native = await camera.screenshot({ animations: 'disabled', scale: 'css' });
        const afterScreenshot = await camera.evaluate((element) =>
          (element as HTMLElement & { paintSnapshot(phase: string): unknown }).paintSnapshot(
            'after-screenshot',
          ),
        );
        const comparison = await page.evaluate(
          async ({ actual, expected }) => {
            const decode = async (src: string) => {
              const image = new Image();
              image.src = src;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext('2d')!;
              context.drawImage(image, 0, 0);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
              const result = { pixels, width: canvas.width, height: canvas.height };
              image.src = '';
              canvas.width = 0;
              canvas.height = 0;
              return result;
            };
            const a = await decode(actual),
              e = await decode(expected);
            if (a.width !== e.width || a.height !== e.height)
              throw new Error('Native/tile dimensions differ');
            let total = 0,
              different = 0;
            for (let i = 0; i < a.pixels.length; i += 4) {
              let max = 0;
              for (let c = 0; c < 4; c++) {
                const delta = Math.abs(a.pixels[i + c] - e.pixels[i + c]);
                total += delta;
                max = Math.max(max, delta);
              }
              if (max > 8) different++;
            }
            return {
              width: a.width,
              height: a.height,
              meanChannelError: total / a.pixels.length,
              differentFraction: different / (a.width * a.height),
            };
          },
          { actual: result.png, expected: 'data:image/png;base64,' + native.toString('base64') },
        );
        await info.attach(`paint-${scale}-native.png`, { body: native, contentType: 'image/png' });
        await info.attach(`paint-${scale}-tile.png`, {
          body: Buffer.from(result.png.split(',')[1], 'base64'),
          contentType: 'image/png',
        });
        await info.attach(`paint-${scale}-costs.json`, {
          body: JSON.stringify({
            ...result,
            png: undefined,
            comparison,
            beforeScreenshot,
            afterScreenshot,
            sourceUnits: code.length,
          }),
          contentType: 'application/json',
        });
        expect(result.nativeLabelVisible).toBe(true);
        expect(result.nativeSourceOriginPixelAligned).toBe(true);
        expect(Number.isInteger(result.x * scale)).toBe(true);
        expect(Number.isInteger(result.y * scale)).toBe(true);
        expect(result.decodedPixels).toBe(256 * 256);
        expect(result.png.length).toBeLessThan(1024 * 1024);
        expect(result.label).toContain(kind === 'large-comment' ? 'Finish' : 'Node 199');
        expect(comparison.meanChannelError).toBeLessThanOrEqual(0.5);
        expect(comparison.differentFraction).toBeLessThanOrEqual(0.01);
      }
    });
  }
}

test('rejects a half-pixel native source origin even when 2x maps it to an integer', async ({
  mount,
}) => {
  const component = await mount(MermaidPaintProbe, {
    props: { code: 'flowchart LR\nA[first] --> B[last]' },
  });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
    { timeout: 15_000 },
  );
  const sourceOrigin = await component.getByTestId('native-paint-construction').evaluate((host) => {
    const svg = host.querySelector('.mermaid-svg > svg')!;
    const element = host as HTMLElement;
    element.style.position = 'relative';
    element.style.left = `${238.5 - svg.getBoundingClientRect().left}px`;
    return svg.getBoundingClientRect().left;
  });
  expect(sourceOrigin).toBe(238.5);
  expect(Number.isInteger(sourceOrigin * 2)).toBe(true);
  await expect(
    component.evaluate((element) =>
      (
        element as HTMLElement & { paint(target: 'far', scale: number): Promise<PaintResult> }
      ).paint('far', 2),
    ),
  ).rejects.toThrow('Native Mermaid source origin must use integral CSS pixels');
});

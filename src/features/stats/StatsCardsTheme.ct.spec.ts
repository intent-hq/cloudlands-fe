import { readFile } from 'node:fs/promises';
import { test, expect } from '../../test/ct-test';
import Harness from './StatsCardsThemeHarness.svelte';

function luminance(rgb: number[]) {
  const linear = rgb.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

// Each card has separate scoped styles; each theme must keep its own text/chart
// contrast and survive computed-style serialization into the downloaded PNG.
for (const cardName of ['passport', 'models', 'providers', 'by-hour', 'by-month'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${cardName} stays readable and exports the active ${theme} theme`, async ({
      mount,
      page,
    }, testInfo) => {
      const mounted = await mount(Harness, { props: { card: cardName } });
      const card = mounted.locator('[data-stats-card]');
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme !== 'dark',
      );
      const previous = await card.evaluate((node) => getComputedStyle(node).backgroundColor);
      // Switch after mounting: existing cards must react without a reload.
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      await page.evaluate(() => document.fonts.ready);
      const measurements = await card.evaluate((root) => {
        const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const background = (node: Element): number[] => {
          const color = rgb(getComputedStyle(node).backgroundColor);
          if ((color[3] ?? 1) === 1) return color.slice(0, 3);
          const beneath = node.parentElement ? background(node.parentElement) : [255, 255, 255];
          const alpha = color[3] ?? 1;
          return color.slice(0, 3).map((channel, i) => channel * alpha + beneath[i] * (1 - alpha));
        };
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const labels = [];
        while (walker.nextNode()) {
          const text = walker.currentNode;
          const node = text.parentElement!;
          if (!text.textContent?.trim() || node.closest('button, svg')) continue;
          const style = getComputedStyle(node);
          const bg = background(node);
          const opacity = Number(style.opacity);
          const fg = rgb(style.color)
            .slice(0, 3)
            .map((c, i) => c * opacity + bg[i] * (1 - opacity));
          labels.push({ text: text.textContent, fg, bg });
        }
        const swatches = Array.from(root.querySelectorAll('.swatch, .bar-seg'), (node) => ({
          color: rgb(getComputedStyle(node).backgroundColor),
          bg: background(node.parentElement!),
        }));
        const rect = root.getBoundingClientRect();
        const exportSamples = [{ x: 180, y: 8, color: background(root) }];
        for (const node of root.querySelectorAll('.swatch, .bar-seg, .foot, .footer')) {
          const box = node.getBoundingClientRect();
          exportSamples.push({
            x: box.left - rect.left + Math.min(5, box.width / 2),
            y: box.top - rect.top + Math.min(5, box.height / 2),
            color: background(node),
          });
        }
        const segments = Array.from(root.querySelectorAll('.bar-in, .bar-out, .bar-thought'))
          .filter(
            (node) =>
              node.getBoundingClientRect().height > 0 && !node.classList.contains('seg-stub'),
          )
          .map((node) => ({ color: background(node), bg: background(root) }));
        return {
          exportSamples,
          segments,
          labels,
          swatches,
          background: background(root),
          surface: getComputedStyle(root).backgroundColor,
        };
      });
      expect.soft(measurements.surface, 'live theme change reaches the card').not.toBe(previous);
      for (const label of measurements.labels) {
        expect
          .soft(contrast(label.fg, label.bg), `readable text: ${label.text}`)
          .toBeGreaterThanOrEqual(4.5);
      }
      for (const swatch of [...measurements.swatches, ...measurements.segments]) {
        expect
          .soft(contrast(swatch.color, swatch.bg), 'chart series visible against the card')
          .toBeGreaterThanOrEqual(3);
      }
      expect(new Set(measurements.swatches.map(({ color }) => color.join(','))).size).toBe(
        measurements.swatches.length,
      );
      const screenshot = testInfo.outputPath(`${cardName}-${theme}.png`);
      await card.screenshot({ path: screenshot });
      await testInfo.attach('card', { path: screenshot, contentType: 'image/png' });
      const downloaded = page.waitForEvent('download');
      await mounted.getByRole('button', { name: 'Export test card' }).click();
      const download = await downloaded;
      const exported = testInfo.outputPath(`${cardName}-${theme}-export.png`);
      await download.saveAs(exported);
      await testInfo.attach('export', { path: exported, contentType: 'image/png' });
      const png = await readFile(exported);
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe(1920);
      // Exported surface, footer and legend colors must retain the preview's
      // contrast-safe palette after CSS variables are serialized.
      const pixels = await page.evaluate(
        async ({ url, samples }) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          return samples.map(({ x, y }) =>
            Array.from(ctx.getImageData(Math.round(x * 3), Math.round(y * 3), 1, 1).data),
          );
        },
        {
          url: `data:image/png;base64,${png.toString('base64')}`,
          samples: measurements.exportSamples,
        },
      );
      for (const [index, pixel] of pixels.entries()) {
        expect(pixel[3]).toBe(255);
        for (let i = 0; i < 3; i++)
          expect(
            Math.abs(pixel[i] - measurements.exportSamples[index].color[i]),
          ).toBeLessThanOrEqual(1);
      }
    });
  }
}

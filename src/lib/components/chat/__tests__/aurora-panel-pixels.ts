import type { Locator } from '@playwright/test';
import sharp from 'sharp';

export type Pixel = [number, number, number, number];

export const colorDistance = (first: Pixel, second: Pixel) =>
  Math.max(...first.slice(0, 3).map((channel, index) => Math.abs(channel - second[index])));

export const isPaintProbe = ([red, green, blue]: Pixel) => red > 200 && green < 140 && blue > 200;

export async function applyAuroraPaintProbe(aurora: Locator) {
  await aurora.evaluate((node) => {
    const host = node as HTMLElement;
    host.style.background = 'rgb(255 0 255)';
    for (const child of host.children) {
      (child as HTMLElement).style.opacity = '0';
    }
  });
}

export async function samplePanelBottomPixels(panel: Locator) {
  const [screenshot, geometry] = await Promise.all([
    panel.screenshot({ animations: 'disabled' }),
    panel.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        renderedWidth: box.width,
        layoutWidth: (node as HTMLElement).offsetWidth,
        radius: Number.parseFloat(getComputedStyle(node).borderBottomLeftRadius),
      };
    }),
  ]);
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const pixel = (x: number, y: number): Pixel => {
    const offset = (Math.max(0, Math.min(info.height - 1, y)) * info.width + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  };
  const renderedScale = geometry.renderedWidth / geometry.layoutWidth;
  const screenshotScale = info.width / geometry.renderedWidth;
  const radius = Math.max(4, Math.round(geometry.radius * renderedScale * screenshotScale));
  const cornerInset = Math.max(1, Math.round(screenshotScale));
  const edgeInset = Math.max(4, Math.round(4 * screenshotScale));

  return {
    corners: [
      pixel(cornerInset, info.height - cornerInset),
      pixel(info.width - cornerInset - 1, info.height - cornerInset),
    ],
    straightEdges: [
      pixel(Math.floor(info.width / 2), info.height - edgeInset - 1),
      pixel(edgeInset, info.height - radius - edgeInset),
      pixel(info.width - edgeInset - 1, info.height - radius - edgeInset),
    ],
  };
}

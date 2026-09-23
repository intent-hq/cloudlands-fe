import type { Locator } from '@playwright/test';
import sharp from 'sharp';

export type Pixel = [number, number, number, number];

export const colorDistance = (first: Pixel, second: Pixel) =>
  Math.max(...first.slice(0, 3).map((channel, index) => Math.abs(channel - second[index])));

// The panel's horizontal scroll fade dims the probe over dark backgrounds.
// Detect its magenta channel contrast, not an absolute brightness that rejects
// still-painted pixels (and can miss similarly dimmed leaks outside the clip).
export const isPaintProbe = ([red, green, blue]: Pixel) => Math.min(red, blue) - green > 100;

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
      const style = getComputedStyle(node);
      return {
        renderedWidth: box.width,
        layoutWidth: (node as HTMLElement).offsetWidth,
        radius: Number.parseFloat(style.borderBottomLeftRadius),
        borderWidth: Math.max(
          Number.parseFloat(style.borderBottomWidth),
          Number.parseFloat(style.borderLeftWidth),
          Number.parseFloat(style.borderRightWidth),
        ),
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
  // Sample inside the transparent border but outside the rounded content clip.
  // The border itself cannot reveal escaped Aurora paint, even with square corners.
  const cornerInset = Math.max(
    1,
    Math.ceil(geometry.borderWidth * renderedScale * screenshotScale),
  );
  const insideCornerInset = Math.max(2, Math.round(radius * 0.55));
  const edgeInset = Math.max(4, Math.round(4 * screenshotScale));

  return {
    outsideCorners: [
      pixel(cornerInset, info.height - cornerInset - 1),
      pixel(info.width - cornerInset - 1, info.height - cornerInset - 1),
    ],
    insideCorners: [
      pixel(insideCornerInset, info.height - insideCornerInset - 1),
      pixel(info.width - insideCornerInset - 1, info.height - insideCornerInset - 1),
    ],
    straightEdges: [
      pixel(Math.floor(info.width / 2), info.height - edgeInset - 1),
      pixel(edgeInset, info.height - radius - edgeInset),
      pixel(info.width - edgeInset - 1, info.height - radius - edgeInset),
    ],
  };
}

#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSandboxArgs, runSandbox } from './runner.mjs';

export function safeFilenamePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'preview';
}

export function defaultScreenshotPath(options) {
  const parts = [options.scene, options.state, options.theme, options.width].map((value) =>
    safeFilenamePart(String(value)),
  );
  return path.join('.demo-artifacts', 'sandbox', `${parts.join('--')}.png`);
}

export function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Screenshot did not produce a valid PNG.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function fitViewportToElement(page, locator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('The component frame has no bounding box.');
    const next = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
    const current = page.viewportSize();
    if (current?.width === next.width && current.height === next.height) return;
    await page.setViewportSize(next);
  }
}

export async function captureSandboxScreenshot(options) {
  const outputPath = options.out ?? defaultScreenshotPath(options);
  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });

  return runSandbox(options, async ({ page, url }) => {
    const frame = page.locator('[data-testid="catalog-scene-focus"]');
    await fitViewportToElement(page, frame);
    const png = await frame.screenshot({ path: absoluteOutputPath });
    return { outputPath, dimensions: pngDimensions(png), url };
  });
}

async function main(argv) {
  const result = await captureSandboxScreenshot(parseSandboxArgs(argv));
  console.log(
    `${result.outputPath} ${result.dimensions.width}x${result.dimensions.height} ${result.url}`,
  );
}

const directRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (directRun) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`sandbox:shot: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

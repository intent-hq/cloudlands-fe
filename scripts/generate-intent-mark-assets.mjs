import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import prettier from 'prettier';

// The supplied GIFs are the motion source, not screenshots of our implementation.
// Remove only their white matte. Keep every frame and its original duration.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'static/intent-mark');
const columns = 8;
const size = 256;
await mkdir(output, { recursive: true });

for (const variant of ['pulse', 'bloom', 'twist']) {
  const source = await readFile(path.join(root, `test/fixtures/intent-mark/${variant}.gif`));
  const image = sharp(source, { animated: true });
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const frames = metadata.pages;
  if (info.width !== size || metadata.pageHeight !== size || info.channels !== 3) {
    throw new Error(`Unexpected source format for ${variant}`);
  }
  if (!metadata.delay?.every((delay) => delay === 40)) {
    throw new Error(`Expected 40ms source frames for ${variant}`);
  }
  const rows = Math.ceil(frames / columns);
  const width = columns * size;
  const height = rows * size;
  const atlas = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const input = ((frame * size + y) * size + x) * 3;
        const target =
          ((Math.floor(frame / columns) * size + y) * width + (frame % columns) * size + x) * 4;
        atlas[target] = atlas[target + 1] = atlas[target + 2] = 255;
        atlas[target + 3] = 255 - Math.round((data[input] + data[input + 1] + data[input + 2]) / 3);
      }
    }
  }
  const png = sharp(atlas, { raw: { width, height, channels: 4 } });
  await png
    .clone()
    .png()
    .toFile(path.join(output, `${variant}.png`));
  if (variant === 'pulse') {
    await png
      .clone()
      .extract({ left: 0, top: 0, width: size, height: size })
      .png()
      .toFile(path.join(output, 'neutral.png'));
    const positions = Array.from({ length: frames + 1 }, (_, index) => {
      const frame = index % frames;
      return `${((index / frames) * 100).toFixed(8)}% { transform: translate(${(-frame % columns) * size}px, ${-Math.floor(frame / columns) * size}px); }`;
    }).join('\n');
    const css = `/* Generated from test/fixtures/intent-mark/pulse.gif. Run node scripts/generate-intent-mark-assets.mjs. */
      .intent-pulse-frames {
        width: ${width}px;
        height: ${height}px;
        background: currentColor;
        mask: url('./pulse.png') 0 0 / 100% 100% no-repeat;
        forced-color-adjust: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .intent-pulse-frames { animation: intent-pulse ${frames * 40}ms steps(1, end) infinite; }
      }
      @keyframes intent-pulse { ${positions} }`;
    const cssPath = path.join(output, 'pulse.css');
    const format = await prettier.resolveConfig(cssPath);
    await writeFile(cssPath, await prettier.format(css, { ...format, parser: 'css' }));
  }
  console.log(`${variant}: ${frames} frames, ${frames * 40}ms, ${width}x${height}`);
}

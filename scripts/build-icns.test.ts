import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const iconsDirectory = join(process.cwd(), 'src/assets/icons');
const devSourcePath = join(iconsDirectory, 'app-icon/Dev-Source.png');
const devPngPath = join(iconsDirectory, 'dev-icon.png');

async function alphaBounds(file: string | Buffer) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { width: info.width, height: info.height, left, top, right, bottom };
}

describe('development app icon assets', () => {
  it('keeps the canonical source and generated PNG cropped to their alpha bounds', async () => {
    expect(await alphaBounds(devSourcePath)).toEqual({
      width: 864,
      height: 864,
      left: 0,
      top: 0,
      right: 863,
      bottom: 863,
    });
    expect(await alphaBounds(devPngPath)).toEqual({
      width: 512,
      height: 512,
      left: 0,
      top: 0,
      right: 511,
      bottom: 511,
    });
  });

  it('contains the required PNG representations in the ICO container', async () => {
    const ico = readFileSync(join(iconsDirectory, 'dev-icon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 6]);
    const sizes = [];
    for (let index = 0; index < 6; index += 1) {
      const entry = 6 + index * 16;
      const size = ico[entry] || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(await sharp(ico.subarray(offset, offset + length)).metadata()).toMatchObject({
        format: 'png',
        width: size,
        height: size,
      });
      sizes.push(size);
    }
    expect(sizes).toEqual([16, 32, 48, 64, 128, 256]);
  });

  it('contains the required representations in the ICNS container', async () => {
    const icns = readFileSync(join(iconsDirectory, 'dev-icon.icns'));
    expect(icns.toString('ascii', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const chunks = new Map<string, Buffer>();
    for (let offset = 8; offset < icns.length;) {
      const type = icns.toString('ascii', offset, offset + 4);
      const length = icns.readUInt32BE(offset + 4);
      chunks.set(type, icns.subarray(offset + 8, offset + length));
      offset += length;
    }
    expect([...chunks.keys()]).toEqual(expect.arrayContaining(['ic04', 'ic05', 'ic11', 'ic12']));
    const pngSizes = await Promise.all(
      ['ic07', 'ic08', 'ic09', 'ic10', 'ic13', 'ic14'].map(
        async (type) => (await sharp(chunks.get(type)).metadata()).width,
      ),
    );
    expect(pngSizes.sort((a, b) => Number(a) - Number(b))).toEqual([128, 256, 256, 512, 512, 1024]);
  });
});

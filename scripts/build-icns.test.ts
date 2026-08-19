import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const iconsDirectory = join(process.cwd(), 'src/assets/icons');
const devSourcePath = join(iconsDirectory, 'app-icon/Dev-Source.png');
const devPngPath = join(iconsDirectory, 'dev-icon.png');
const devSourceSha256 = '4e6e13f59557bb3ee33ed7810ba07d05f7308d564e16456b1117885822c68581';
const generatedAlphaBounds: Record<
  number,
  { left: number; top: number; right: number; bottom: number }
> = {
  16: { left: 1, top: 0, right: 14, bottom: 15 },
  32: { left: 0, top: 0, right: 31, bottom: 31 },
  48: { left: 2, top: 2, right: 45, bottom: 45 },
  64: { left: 3, top: 4, right: 60, bottom: 59 },
  128: { left: 10, top: 10, right: 117, bottom: 118 },
  256: { left: 20, top: 22, right: 235, bottom: 238 },
  512: { left: 40, top: 45, right: 471, bottom: 477 },
  1024: { left: 80, top: 91, right: 943, bottom: 954 },
};

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
  it('preserves the complete approved source canvas and generated PNG spacing', async () => {
    expect(createHash('sha256').update(readFileSync(devSourcePath)).digest('hex')).toBe(
      devSourceSha256,
    );
    expect(await alphaBounds(devSourcePath)).toEqual({
      width: 1024,
      height: 1024,
      ...generatedAlphaBounds[1024],
    });
    expect(await alphaBounds(devPngPath)).toEqual({
      width: 512,
      height: 512,
      ...generatedAlphaBounds[512],
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
      const image = ico.subarray(offset, offset + length);
      expect(await sharp(image).metadata()).toMatchObject({
        format: 'png',
        width: size,
        height: size,
      });
      expect(await alphaBounds(image)).toEqual({
        width: size,
        height: size,
        ...generatedAlphaBounds[size],
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
      ['ic07', 'ic08', 'ic09', 'ic10', 'ic13', 'ic14'].map(async (type) => {
        const image = chunks.get(type)!;
        const size = (await sharp(image).metadata()).width;
        if (!size) throw new Error(`Missing size for ${type}`);
        expect(await alphaBounds(image)).toEqual({
          width: size,
          height: size,
          ...generatedAlphaBounds[size],
        });
        return size;
      }),
    );
    expect(pngSizes.sort((a, b) => Number(a) - Number(b))).toEqual([128, 256, 256, 512, 512, 1024]);
  });
});

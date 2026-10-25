// @verify-changed-triggers: src/assets/icons/icon.ico, src/assets/icons/dev-icon.ico, src/assets/icons/dev-icon.icns,
//   src/assets/icons/dev-icon.png, src/assets/icons/app-icon/*.png

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ICO_SIZES } from './build-icns.js';

const iconsDirectory = join(process.cwd(), 'src/assets/icons');
function icoImages(file: string | Buffer) {
  const ico = Buffer.isBuffer(file) ? file : readFileSync(file);
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([
    0,
    1,
    ICO_SIZES.length,
  ]);
  return ICO_SIZES.map((expectedSize, index) => {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    expect(size).toBe(expectedSize);
    return { size, image: ico.subarray(offset, offset + length) };
  });
}

describe('release Windows app icon asset', () => {
  it('contains every required PNG size', async () => {
    const images = icoImages(join(iconsDirectory, 'icon.ico'));
    for (const { size, image } of images) {
      expect(await sharp(image).metadata()).toMatchObject({
        format: 'png',
        width: size,
        height: size,
      });
    }
  });
});

describe('development app icon assets', () => {
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
        return size;
      }),
    );
    expect(pngSizes.sort((a, b) => Number(a) - Number(b))).toEqual([128, 256, 256, 512, 512, 1024]);
  });
});

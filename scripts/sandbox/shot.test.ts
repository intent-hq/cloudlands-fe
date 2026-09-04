// @vitest-environment node
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { defaultScreenshotPath, pngDimensions, safeFilenamePart } from './shot.mjs';

describe('sandbox screenshot output', () => {
  it('builds the default artifact path from resolved options', () => {
    expect(
      defaultScreenshotPath({
        scene: 'workspace-hover-card',
        state: 'landscape-wide',
        theme: 'dark',
        width: 720,
      }),
    ).toBe('.demo-artifacts/sandbox/workspace-hover-card--landscape-wide--dark--720.png');
  });

  it('sanitizes user-controlled filename parts', () => {
    expect(safeFilenamePart('../wide state')).toBe('..-wide-state');
  });

  it('reads pixel dimensions from the PNG header', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
    png.writeUInt32BE(1440, 16);
    png.writeUInt32BE(900, 20);
    expect(pngDimensions(png)).toEqual({ width: 1440, height: 900 });
  });
});

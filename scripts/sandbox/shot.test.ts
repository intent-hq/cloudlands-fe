// @vitest-environment node
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({ runSandbox: vi.fn() }));
vi.mock('./runner.mjs', () => ({ parseSandboxArgs: vi.fn(), runSandbox: runner.runSandbox }));
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  captureSandboxScreenshot,
  defaultScreenshotPath,
  pngDimensions,
  safeFilenamePart,
} from './shot.mjs';

beforeEach(() => vi.clearAllMocks());

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

  it('waits for responsive layout stability after resizing and before capture', async () => {
    const events = [];
    let viewport = { width: 420, height: 900 };
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
    png.writeUInt32BE(420, 16);
    png.writeUInt32BE(300, 20);
    const frame = {
      boundingBox: vi.fn().mockResolvedValue({ width: 420, height: 300 }),
      screenshot: vi.fn(async () => {
        events.push('capture');
        return png;
      }),
    };
    const page = {
      locator: vi.fn(() => frame),
      viewportSize: vi.fn(() => viewport),
      setViewportSize: vi.fn(async (nextViewport) => {
        events.push('resize');
        viewport = nextViewport;
      }),
    };
    runner.runSandbox.mockImplementation(async (_options, action) =>
      action({
        page,
        url: 'http://localhost:5173/sandbox/workspace-hover-card',
        waitForStability: async () => events.push('stable'),
      }),
    );

    await captureSandboxScreenshot({
      scene: 'workspace-hover-card',
      state: 'landscape-narrow',
      theme: 'light',
      width: 420,
      out: '/tmp/sandbox-responsive-shot.png',
    });

    expect(events).toEqual(['resize', 'stable', 'capture']);
  });
});

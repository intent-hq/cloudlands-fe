/**
 * Tests for image-resize utility.
 *
 * Because the utility relies on OffscreenCanvas and createImageBitmap (renderer
 * APIs), we mock them at the global level so the tests run in Node/Vitest.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Pixel data returned by getImageData — default fully opaque. */
let mockPixelData: Uint8ClampedArray;

/** Dimensions reported by createImageBitmap. */
let mockImageWidth: number;
let mockImageHeight: number;

/** Captured convertToBlob options for assertions. */
let capturedBlobOptions: { type?: string; quality?: number } | undefined;

/** Track drawImage calls to verify resize dimensions. */
let capturedDrawArgs: unknown[];

function setupMocks() {
  const ctx = {
    drawImage: (...args: unknown[]) => {
      capturedDrawArgs = args;
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: mockPixelData ?? new Uint8ClampedArray(w * h * 4).fill(255),
    }),
  };

  class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return ctx;
    }
    async convertToBlob(opts?: { type?: string; quality?: number }) {
      capturedBlobOptions = opts;
      // Return a mock blob with arrayBuffer support
      const content = new TextEncoder().encode('test-image-data');
      return {
        type: opts?.type ?? 'image/png',
        arrayBuffer: async () => content.buffer,
      };
    }
  }

  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  vi.stubGlobal('createImageBitmap', async () => ({
    width: mockImageWidth,
    height: mockImageHeight,
    close: () => {},
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resizeImageForAgent', () => {
  beforeEach(() => {
    mockImageWidth = 800;
    mockImageHeight = 600;
    mockPixelData = new Uint8ClampedArray(800 * 600 * 4).fill(255); // opaque
    capturedBlobOptions = undefined;
    capturedDrawArgs = [];
    setupMocks();
  });

  // Lazy import so mocks are installed first
  async function getResize() {
    return (await import('../image-resize')).resizeImageForAgent;
  }

  const TINY_BASE64 = btoa('x'.repeat(100)); // Dummy base64 data

  it('returns JPEG unchanged when within dimension limits', async () => {
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/jpeg');
    expect(result.base64).toBe(TINY_BASE64);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('resizes JPEG when longest dimension exceeds 1568', async () => {
    mockImageWidth = 3136;
    mockImageHeight = 2000;
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/jpeg');
    // Should have been drawn at half size
    expect(capturedDrawArgs[3]).toBe(1568); // target width
    expect(capturedDrawArgs[4]).toBe(Math.round(2000 * (1568 / 3136))); // target height
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('converts opaque PNG to JPEG', async () => {
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/png');
    expect(result.mimeType).toBe('image/jpeg');
    expect(capturedBlobOptions?.type).toBe('image/jpeg');
    expect(capturedBlobOptions?.quality).toBe(0.85);
  });

  it('preserves PNG when image has transparency', async () => {
    // Set one pixel's alpha to 0 (transparent)
    mockPixelData = new Uint8ClampedArray(800 * 600 * 4).fill(255);
    mockPixelData[3] = 0; // first pixel alpha = 0
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/png');
    expect(result.mimeType).toBe('image/png');
  });

  it('resizes PNG and converts to JPEG when opaque and oversized', async () => {
    mockImageWidth = 2000;
    mockImageHeight = 3000;
    // Need pixel data sized for the *target* canvas (which getImageData sees)
    const targetW = Math.round(2000 * (1568 / 3000));
    const targetH = 1568;
    mockPixelData = new Uint8ClampedArray(targetW * targetH * 4).fill(255);
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/png');
    expect(result.mimeType).toBe('image/jpeg');
    expect(capturedDrawArgs[4]).toBe(1568); // longest dim capped
  });

  it('does not resize PNG already within limits but still converts opaque to JPEG', async () => {
    mockImageWidth = 500;
    mockImageHeight = 500;
    mockPixelData = new Uint8ClampedArray(500 * 500 * 4).fill(255);
    const resize = await getResize();
    const result = await resize(TINY_BASE64, 'image/png');
    expect(capturedDrawArgs[3]).toBe(500);
    expect(capturedDrawArgs[4]).toBe(500);
    expect(result.mimeType).toBe('image/jpeg');
  });
});

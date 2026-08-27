import { describe, expect, it } from 'vitest';
import {
  inferBrowserScreenshotMimeType,
  resolveBrowserScreenshotSource,
} from '../browser-screenshot-source';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2kAAAAASUVORK5CYII=';
const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

describe('browser screenshot image sources', () => {
  it.each([
    [PNG_1PX, 'image/png'],
    [JPEG_1PX, 'image/jpeg'],
  ] as const)('infers image metadata from a real %s payload', (base64, mimeType) => {
    expect(inferBrowserScreenshotMimeType(base64)).toBe(mimeType);
    expect(resolveBrowserScreenshotSource({ screenshotBase64: base64 })).toBe(
      `data:${mimeType};base64,${base64}`,
    );
  });

  it.each([
    'workspace-asset://workspace-1/screenshot.jpg',
    'https://assets.example.test/screenshot.png',
    'http://127.0.0.1/screenshot.png',
  ])('accepts a safe screenshot URL: %s', (screenshotUrl) => {
    expect(resolveBrowserScreenshotSource({ screenshotUrl })).toBe(screenshotUrl);
  });

  it.each(['javascript:alert(1)', 'data:text/html;base64,AAAA', 'file:///tmp/shot.png'])(
    'rejects an unsafe screenshot URL: %s',
    (screenshotUrl) => {
      expect(resolveBrowserScreenshotSource({ screenshotUrl })).toBeNull();
    },
  );

  it.each(['not base64 data', 'QUFBQQ==', 'iVBOR'])(
    'rejects invalid or non-image base64: %s',
    (base64) => {
      expect(resolveBrowserScreenshotSource({ screenshotBase64: base64 })).toBeNull();
    },
  );
});

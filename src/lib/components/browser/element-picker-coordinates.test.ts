import { describe, expect, it } from 'vitest';
import { toWebviewCaptureRect } from './element-picker-coordinates';

describe('toWebviewCaptureRect', () => {
  it('converts emulated CSS coordinates when the page is scaled below one', () => {
    expect(
      toWebviewCaptureRect(
        { x: 101, y: 51, width: 199, height: 99 },
        { width: 640, height: 400 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ x: 50, y: 25, width: 100, height: 50 });
  });

  it('clips partially offscreen rectangles to the webview bounds', () => {
    expect(
      toWebviewCaptureRect(
        { x: -20, y: 790, width: 60, height: 40 },
        { width: 640, height: 400 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({ x: 0, y: 395, width: 20, height: 5 });
  });
});

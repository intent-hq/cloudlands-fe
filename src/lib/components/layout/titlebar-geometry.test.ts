import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCounterScaledTitlebarHeight, WINDOW_TITLEBAR_HEIGHT_PX } from './titlebar-geometry';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('shared title-bar geometry', () => {
  it.each([
    [1, 35],
    [1.25, 28],
    [1.5, 35 / 1.5],
    [2, 17.5],
  ])('counter-scales the %sx zoom band to %spx', (zoomFactor, expectedHeight) => {
    expect(getCounterScaledTitlebarHeight(zoomFactor)).toBeCloseTo(expectedHeight);
  });

  it('keeps the title bar and columns sidebar offset on the same token', () => {
    const titlebar = source('./WindowTitleBar.svelte');
    const layout = source('../../../routes/(app)/+layout.svelte');

    expect(WINDOW_TITLEBAR_HEIGHT_PX).toBe(35);
    expect(titlebar).toContain('getCounterScaledTitlebarHeight($zoomFactor)');
    expect(titlebar).toContain('style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"');
    expect(titlebar).toContain('box-sizing: border-box');
    expect(layout).toContain('getCounterScaledTitlebarHeight($zoomFactor)');
    expect(titlebar).not.toContain('35 / $zoomFactor');
    expect(titlebar).not.toContain('height: 35px');
    expect(layout).not.toContain('35 / $zoomFactor');
  });
});

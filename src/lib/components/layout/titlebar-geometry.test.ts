/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCounterScaledTitlebarHeight, WINDOW_TITLEBAR_HEIGHT_PX } from './titlebar-geometry';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('shared title-bar geometry', () => {
  it('affirms titlebar border-box geometry in every required visual state', async () => {
    const observed = await exerciseVisualStates(({ zoom }) => {
      const target = document.createElement('button');
      document.body.append(target);
      target.style.height = `${getCounterScaledTitlebarHeight(zoom)}px`;
      return {
        container: target,
        target,
        unmount: () => target.remove(),
        assertCapability: () => {
          expect(target.style.height).toBe(`${35 / zoom}px`);
          expect(WINDOW_TITLEBAR_HEIGHT_PX).toBe(35);
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it.each([
    [1, 35],
    [1.25, 28],
    [1.5, 35 / 1.5],
    [2, 17.5],
  ])('counter-scales the %sx zoom band to %spx', (zoomFactor, expectedHeight) => {
    expect(getCounterScaledTitlebarHeight(zoomFactor)).toBeCloseTo(expectedHeight);
  });

  it('keeps the title bar on the shared geometry token', () => {
    const titlebar = source('./WindowTitleBar.svelte');

    expect(WINDOW_TITLEBAR_HEIGHT_PX).toBe(35);
    expect(titlebar).toContain('getCounterScaledTitlebarHeight($zoomFactor)');
    expect(titlebar).toContain('style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"');
    expect(titlebar).toContain('box-sizing: border-box');
    expect(titlebar).not.toContain('35 / $zoomFactor');
    expect(titlebar).not.toContain('height: 35px');
  });

  it('keeps macOS clearance separate from the fixed-control optical shift', () => {
    const titlebar = source('./WindowTitleBar.svelte');

    expect(titlebar).toContain('--titlebar-control-shift: 0px');
    expect(titlebar).toMatch(
      /\.window-title-bar:global\(\.window-title-bar-mac\)[^{]*\{[^}]*--titlebar-control-shift:\s*8px;[^}]*padding-left:\s*60px;/s,
    );
    expect(titlebar).toContain('titlebar-left-drag-handle shrink-0 self-stretch');
    expect(titlebar).toContain('titlebar-fixed-controls flex min-w-0 items-center gap-1');
    expect(titlebar).toContain('data-titlebar-workspace-controls');
    expect(titlebar).toContain('width: calc(16px - var(--titlebar-control-shift))');
    expect(titlebar).toContain('padding-right: var(--titlebar-control-shift)');
  });
});

import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import type { NoteContentState } from '../NoteContentSurface.svelte';
import NoteContentSurfaceGeometryHost from './NoteContentSurfaceGeometryHost.svelte';

const states: NoteContentState[] = [
  'editor',
  'loading',
  'empty',
  'missing',
  'read-only',
  'recent-note',
];
const scenarios = [
  { name: 'light', theme: 'light' as const, width: 480, zoom: 1 },
  { name: 'dark', theme: 'dark' as const, width: 480, zoom: 1 },
  { name: 'light narrow at 200%', theme: 'light' as const, width: 260, zoom: 2 },
  { name: 'dark narrow at 200%', theme: 'dark' as const, width: 260, zoom: 2 },
];

async function readSurface(surface: Locator, probe: Locator) {
  const [geometry, background, expectedBackground] = await Promise.all([
    surface.evaluate((element) => {
      const surfaceBox = element.getBoundingClientRect();
      const parentBox = element.parentElement!.getBoundingClientRect();
      return {
        widthDelta: Math.abs(surfaceBox.width - parentBox.width),
        heightDelta: Math.abs(surfaceBox.height - parentBox.height),
      };
    }),
    surface.evaluate((element) => getComputedStyle(element).backgroundColor),
    probe.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  return { geometry, background, expectedBackground };
}

for (const scenario of scenarios) {
  for (const state of states) {
    test(`${state} uses the full background surface in ${scenario.name}`, async ({ mount }) => {
      const component = await mount(NoteContentSurfaceGeometryHost, {
        props: { ...scenario, state },
      });
      const surface = component.locator('[data-note-content-surface]');
      const probe = component.locator('[data-background-probe]');

      await expect(surface).toHaveAttribute('data-note-content-state', state);
      await expect
        .poll(async () => {
          const { geometry, background, expectedBackground } = await readSurface(surface, probe);
          return {
            backgroundReady: background === expectedBackground && background !== 'rgba(0, 0, 0, 0)',
            heightReady: geometry.heightDelta < 0.5,
            widthReady: geometry.widthDelta < 0.5,
          };
        })
        .toEqual({ backgroundReady: true, heightReady: true, widthReady: true });
      const { geometry, background, expectedBackground } = await readSurface(surface, probe);

      expect(background).toBe(expectedBackground);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      expect(geometry.widthDelta).toBeLessThan(0.5);
      expect(geometry.heightDelta).toBeLessThan(0.5);
    });
  }
}

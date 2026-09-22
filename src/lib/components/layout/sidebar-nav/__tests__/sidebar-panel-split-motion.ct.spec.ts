import { expect, test } from '../../../../../test/ct-test';
import type { ComponentFixtures } from '@playwright/experimental-ct-svelte';
import SidebarPanelMotionHost from './SidebarPanelMotionHost.svelte';

/**
 * The combined Spaces + Chief panel animates the workspace list's height with
 * the slow, emphasized-out motion tokens (and none under reduced motion).
 * Component styles only resolve in a real browser, so this is the runtime
 * guard for that transition; the jsdom contract suite covers the collapse
 * state itself.
 */

type CtLocator = ReturnType<Awaited<ReturnType<ComponentFixtures['mount']>>['locator']>;

async function measure(component: CtLocator) {
  return component.evaluate((host) => {
    // `cubic-bezier(a, b, c, d)` carries commas of its own.
    const splitTopLevel = (list: string) => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of list) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) parts.push(current.trim());
      return parts;
    };
    // The height entry of an element's computed transition, or null when
    // height is not a transitioned property.
    const heightTransitionOf = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const properties = style.transitionProperty.split(',').map((value) => value.trim());
      const durations = style.transitionDuration.split(',').map((value) => value.trim());
      const timings = splitTopLevel(style.transitionTimingFunction);
      const index = properties.indexOf('height');
      if (index === -1) return null;
      return {
        duration: durations[index % durations.length],
        timingFunction: timings[index % timings.length],
      };
    };

    const spaces = host.querySelector<HTMLElement>('[data-combined-panel-spaces]')!;
    // Probe: the token pair resolved in the same subtree, so the assertion
    // compares against the live token values rather than a copied number.
    const probe = document.createElement('div');
    probe.style.transition = 'height var(--motion-slow) var(--ease-emphasized-out)';
    spaces.parentElement!.appendChild(probe);
    const expected = heightTransitionOf(probe);
    const actual = heightTransitionOf(spaces);
    probe.remove();
    return { expected, actual, inlineHeight: spaces.style.height };
  });
}

test('animates the Spaces list height with the slow emphasized-out motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(SidebarPanelMotionHost);
  await expect(component.locator('[data-combined-panel-spaces]')).toBeVisible();

  const { expected, actual, inlineHeight } = await measure(component);

  expect(inlineHeight).toMatch(/%$/);
  expect(expected).not.toBeNull();
  expect(parseFloat(expected!.duration)).toBeGreaterThan(0);
  expect(actual).toEqual(expected);
});

test('drops the Spaces list height motion under reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(SidebarPanelMotionHost);
  await expect(component.locator('[data-combined-panel-spaces]')).toBeVisible();

  const { actual } = await measure(component);

  // tokens.css pins reduced-motion durations to 0.01ms (not 0) so
  // transitionend still fires; anything at or under that is "no motion".
  expect(actual).not.toBeNull();
  expect(parseFloat(actual!.duration)).toBeLessThanOrEqual(0.00001);
});

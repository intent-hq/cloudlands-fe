import { expect, test } from '../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import NeutralBorderContractHost from './NeutralBorderContractHost.svelte';

type Edge = 'top' | 'right';

const probes = [
  ['launcher', '[data-sidebar-launcher="browser"]', 'top'],
  ['popover', '[data-slot="menu-content"]', 'top'],
  ['form', '[data-slot="input"]', 'top'],
] as const satisfies ReadonlyArray<readonly [string, string, Edge]>;

// Subscription surfaces and chat prompts have no border.
const borderlessProbes = [
  ['subscription', '[data-testid="event-subscriptions-card"]', 'top'],
  ['chat', '[data-testid="pinned-user-prompt"]', 'top'],
] as const satisfies ReadonlyArray<readonly [string, string, Edge]>;

// Panel shells reserve a focus-invariant 1px border that stays transparent while unfocused
// (see panel-shell-corners.ct.spec.ts).
const panelShellSelector = '.panel';

const sampledSelectors = [
  ...probes.map(([, selector]) => selector),
  ...borderlessProbes.map(([, selector]) => selector),
  panelShellSelector,
  '[data-testid="panel-border-fixture"] [data-loading-panel] > div:first-child',
  '[data-testid="panel-border-fixture"] [data-loading-panel] > div:last-child',
  '[data-testid="event-subscriptions-outer-header"]',
  '[data-testid="event-subscriptions-preview"]',
].join(', ');

async function settleBorderStyles(page: Page) {
  await page.locator(sampledSelectors).evaluateAll(async (elements) => {
    const animations = elements.flatMap((element) => element.getAnimations());
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
}

async function border(locator: Locator, edge: Edge) {
  return locator.evaluate((element, measuredEdge) => {
    const style = getComputedStyle(element);
    const suffix = measuredEdge[0].toUpperCase() + measuredEdge.slice(1);
    return {
      color: style.getPropertyValue(`border-${measuredEdge}-color`),
      width: style.getPropertyValue(`border-${measuredEdge}-width`),
      ownerCount:
        Number.parseFloat(style.getPropertyValue(`border-${measuredEdge}-width`)) > 0 ? 1 : 0,
      edge: suffix,
    };
  }, edge);
}

async function seam(page: Page, owner: string, adjacent: string, axis: 'x' | 'y') {
  return page.locator(owner).evaluate(
    (element, { adjacent, axis }) => {
      const sibling = document.querySelector<HTMLElement>(adjacent)!;
      const ownerStyle = getComputedStyle(element);
      const siblingStyle = getComputedStyle(sibling);
      const ownerRect = element.getBoundingClientRect();
      const siblingRect = sibling.getBoundingClientRect();
      return {
        gap: axis === 'x' ? siblingRect.left - ownerRect.right : siblingRect.top - ownerRect.bottom,
        owners:
          axis === 'x'
            ? Number.parseFloat(ownerStyle.borderRightWidth) +
              Number.parseFloat(siblingStyle.borderLeftWidth)
            : Number.parseFloat(ownerStyle.borderBottomWidth) +
              Number.parseFloat(siblingStyle.borderTopWidth),
      };
    },
    { adjacent, axis },
  );
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    test(`production neutral borders share color and single-edge geometry in ${theme} at ${zoom * 100}% zoom`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(NeutralBorderContractHost, { props: { theme, zoom } });
      await component.update({ props: { theme, zoom } });
      await settleBorderStyles(page);
      const styles = await Promise.all(
        probes.map(async ([name, selector, edge]) => ({
          name,
          ...(await border(page.locator(selector), edge)),
        })),
      );

      expect(new Set(styles.map(({ color }) => color)).size).toBe(1);
      expect(styles.every(({ color }) => color.startsWith('rgb('))).toBe(true);
      expect(styles.every(({ width, ownerCount }) => width === '1px' && ownerCount === 1)).toBe(
        true,
      );

      const borderlessStyles = await Promise.all(
        borderlessProbes.map(async ([name, selector, edge]) => ({
          name,
          ...(await border(page.locator(selector), edge)),
        })),
      );
      expect(
        borderlessStyles.every(({ width, ownerCount }) => width === '0px' && ownerCount === 0),
      ).toBe(true);

      const panelBorder = await border(page.locator(panelShellSelector), 'top');
      expect(panelBorder.width).toBe('1px');
      expect(panelBorder.color).toBe('rgba(0, 0, 0, 0)');

      // The shared overlay recipe (85641bef) uses a dark-only structural border.
      const dialogBorder = await border(page.locator('[data-slot="dialog-content"]'), 'top');
      expect(dialogBorder.width).toBe(theme === 'dark' ? '1px' : '0px');
      expect(dialogBorder.ownerCount).toBe(theme === 'dark' ? 1 : 0);
      if (theme === 'dark') expect(dialogBorder.color).toBe(styles[0].color);
      else expect(dialogBorder.color).toBe('rgba(0, 0, 0, 0)');

      const seams = await Promise.all([
        seam(
          page,
          '[data-testid="panel-border-fixture"] [data-loading-panel] > div:first-child',
          '[data-testid="panel-border-fixture"] [data-loading-panel] > div:last-child',
          'y',
        ),
        seam(
          page,
          '[data-testid="event-subscriptions-outer-header"]',
          '[data-testid="event-subscriptions-preview"]',
          'y',
        ),
      ]);
      expect(seams.every(({ gap, owners }) => Math.abs(gap) < 0.1 && owners === 1)).toBe(true);
    });
  }
}

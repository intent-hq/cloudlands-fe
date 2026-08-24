import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import NeutralBorderContractHost from './NeutralBorderContractHost.svelte';

type Edge = 'top' | 'right';

const probes = [
  ['workspace', '[data-workspace-surface-placeholder] > div:first-child', 'right'],
  ['subscription', '[data-testid="event-subscriptions-card"]', 'top'],
  ['launcher', '[data-sidebar-launcher="browser"]', 'top'],
  ['popover', '[data-slot="menu-content"]', 'top'],
  ['dialog', '[data-slot="dialog-content"]', 'top'],
  ['form', '[data-slot="input"]', 'top'],
] as const satisfies ReadonlyArray<readonly [string, string, Edge]>;

const transparentBorderProbes = [['panel', '.panel', 'top']] as const satisfies ReadonlyArray<
  readonly [string, string, Edge]
>;

const borderlessProbes = [
  ['chat', '[data-testid="pinned-user-prompt"]', 'top'],
] as const satisfies ReadonlyArray<readonly [string, string, Edge]>;

const sampledSelectors = [
  ...probes.map(([, selector]) => selector),
  ...transparentBorderProbes.map(([, selector]) => selector),
  ...borderlessProbes.map(([, selector]) => selector),
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

test('production neutral borders share color and single-edge geometry', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(NeutralBorderContractHost);

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
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

      const transparentBorderStyles = await Promise.all(
        transparentBorderProbes.map(async ([name, selector, edge]) => ({
          name,
          ...(await border(page.locator(selector), edge)),
        })),
      );
      expect(
        transparentBorderStyles.every(
          ({ color, width, ownerCount }) =>
            color === 'rgba(0, 0, 0, 0)' && width === '1px' && ownerCount === 1,
        ),
      ).toBe(true);

      const borderlessStyles = await Promise.all(
        borderlessProbes.map(async ([name, selector, edge]) => ({
          name,
          ...(await border(page.locator(selector), edge)),
        })),
      );
      expect(
        borderlessStyles.every(({ width, ownerCount }) => width === '0px' && ownerCount === 0),
      ).toBe(true);

      const seams = await Promise.all([
        seam(
          page,
          '[data-workspace-surface-placeholder] > div:first-child',
          '[data-workspace-surface-placeholder] > div:last-child',
          'x',
        ),
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
    }
  }
});

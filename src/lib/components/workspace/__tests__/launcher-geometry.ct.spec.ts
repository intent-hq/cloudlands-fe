import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import LauncherGeometryHost from './mocks/LauncherGeometryHost.svelte';

const ITEM_COUNT = 26;
const TOLERANCE = 0.5;

async function inspectLauncher(card: Locator) {
  return card.evaluate((node) => {
    const card = node as HTMLElement;
    const cardRect = card.getBoundingClientRect();
    const scale = cardRect.width / card.offsetWidth;
    const stack = card.querySelector<HTMLElement>('[data-sidebar-launcher-icons]')!;
    const labelRect = card
      .querySelector<HTMLElement>('[data-sidebar-launcher-label]')!
      .getBoundingClientRect();
    const items = [...stack.querySelectorAll<HTMLElement>('[data-launcher-preview-item]')].map(
      (item) => {
        const rect = item.getBoundingClientRect();
        const surface = item.querySelector<HTMLElement>(
          '[data-sidebar-launcher-glyph], [data-resource-icon-tile]',
        );
        const surfaceRect = surface?.getBoundingClientRect();
        const textRect = item
          .querySelector<HTMLElement>('span[aria-hidden="true"]')
          ?.getBoundingClientRect();
        return {
          left: (rect.left - cardRect.left) / scale,
          width: rect.width / scale,
          visibleLeft: surfaceRect ? (surfaceRect.left - cardRect.left) / scale : null,
          visibleWidth: surfaceRect ? surfaceRect.width / scale : null,
          overflow:
            item.hasAttribute('data-sidebar-agent-overflow') ||
            item.hasAttribute('data-sidebar-context-overflow'),
          text: textRect?.width
            ? item.querySelector('span[aria-hidden="true"]')?.textContent
            : null,
          textWidth: textRect ? textRect.width / scale : null,
          clientWidth: item.clientWidth,
          scrollWidth: item.scrollWidth,
          inlineWidth: item.style.width,
        };
      },
    );
    return {
      labelLeft: (labelRect.left - cardRect.left) / scale,
      targetSize: stack.dataset.launcherTargetSize,
      visibleSize: stack.dataset.launcherVisibleSize,
      stepSize: stack.dataset.launcherStepSize,
      items,
    };
  });
}

async function inspectResource(card: Locator) {
  return card.evaluate((node) => {
    const card = node as HTMLElement;
    const cardRect = card.getBoundingClientRect();
    const scale = cardRect.width / card.offsetWidth;
    const labelRect = card
      .querySelector<HTMLElement>('[data-sidebar-launcher-label]')!
      .getBoundingClientRect();
    const tileRect = card
      .querySelector<HTMLElement>('[data-resource-icon-tile]')!
      .getBoundingClientRect();
    return {
      leftDelta: Math.abs(tileRect.left - labelRect.left) / scale,
      width: tileRect.width / scale,
      height: tileRect.height / scale,
    };
  });
}

async function expectOpaque(locator: Locator) {
  const styles = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, opacity: style.opacity };
    }),
  );
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every(({ opacity }) => opacity === '1')).toBe(true);
  expect(styles.every(({ background }) => background !== 'rgba(0, 0, 0, 0)')).toBe(true);
}

for (const scenario of [
  { theme: 'light' as const, width: 360, zoom: 1, label: 'narrow light' },
  { theme: 'dark' as const, width: 260, zoom: 2, label: 'narrow dark at 200%' },
]) {
  test(`keeps launcher geometry and surfaces exact in ${scenario.label}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(LauncherGeometryHost, {
      props: { ...scenario, itemCount: ITEM_COUNT },
    });
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${scenario.theme}\\b`));
    await expect(
      component.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]'),
    ).toHaveCount(4);
    expect(await component.evaluate((node) => node.getBoundingClientRect().width)).toBe(
      scenario.width * scenario.zoom,
    );

    for (const launcherId of ['agents', 'context']) {
      const geometry = await inspectLauncher(
        component.locator(`[data-sidebar-launcher="${launcherId}"]`),
      );
      expect(geometry.targetSize).toBe('36');
      expect(geometry.visibleSize).toBe('20');
      expect(geometry.stepSize).toBe('16');
      const visibleItems = geometry.items.filter(({ overflow }) => !overflow);
      const overflow = geometry.items.find((item) => item.overflow)!;
      expect(visibleItems.length).toBeGreaterThan(0);
      expect(
        visibleItems.every(
          ({ width, visibleWidth }) =>
            Math.max(Math.abs(width - 36), Math.abs((visibleWidth ?? 0) - 20)) <= TOLERANCE,
        ),
      ).toBe(true);
      expect(Math.abs(visibleItems[0].visibleLeft! - geometry.labelLeft)).toBeLessThanOrEqual(
        TOLERANCE,
      );
      const steps = visibleItems
        .slice(1)
        .map((item, index) => item.left - visibleItems[index].left);
      expect(steps.every((step) => Math.abs(step - 16) <= TOLERANCE)).toBe(true);
      expect(steps.every((step) => Math.abs(20 - step - 4) <= TOLERANCE)).toBe(true);
      expect(overflow.text).toBe(`+${ITEM_COUNT - visibleItems.length}`);
      expect(overflow.inlineWidth).toBe('');
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      expect(overflow.width).toBeGreaterThanOrEqual((overflow.textWidth ?? 0) - TOLERANCE);
    }

    for (const launcherId of ['context', 'changes']) {
      const resource = await inspectResource(
        component.locator(`[data-sidebar-launcher="${launcherId}"]`),
      );
      expect(resource.leftDelta).toBeLessThanOrEqual(TOLERANCE);
      expect(resource.width).toBeCloseTo(20, 1);
      expect(resource.height).toBeCloseTo(20, 1);
    }

    const glyphs = component.locator('[data-sidebar-launcher-glyph]');
    await expect(
      glyphs.locator(
        '[data-status], [data-status-overlay], [data-avatar-overlay], [data-provider-icon]',
      ),
    ).toHaveCount(0);
    await expectOpaque(component.locator('[data-sidebar-card-surface]'));
    await expectOpaque(component.locator('[data-agent-avatar-with-state]'));
    await expectOpaque(component.locator('[data-resource-icon-tile]'));
  });
}

test('preserves hover, focus, click, and open-marker behavior', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(LauncherGeometryHost, {
    props: { width: 480, zoom: 1, theme: 'light', itemCount: ITEM_COUNT },
  });
  const agents = component.locator('[data-sidebar-agent]');
  const notes = component.locator('[data-sidebar-context]');
  await expect(agents).toHaveCount(6);
  await expect(notes).toHaveCount(6);
  await expect(agents.first().locator('[data-panel-open-marker]')).toHaveAttribute(
    'data-panel-open-state',
    'active',
  );
  await expect(notes.first().locator('[data-panel-open-marker]')).toHaveAttribute(
    'data-panel-open-state',
    'open',
  );

  await agents.first().hover({ position: { x: 2, y: 18 } });
  await expect(page.locator('[data-sidebar-hover-card="agent"]')).toBeVisible();
  await notes.first().focus();
  await expect(notes.first()).toBeFocused();
  await expect(page.locator('[data-sidebar-hover-card="note"]')).toBeVisible();
  await agents.first().focus();
  await page.keyboard.press('Tab');
  await expect(agents.nth(1)).toBeFocused();
  await component.locator('[data-sidebar-agent-overflow]').click();
  await expect(component.locator('[data-sidebar-overlay]')).toBeVisible();
  await expect(component.locator('[data-sidebar-tab-strip]')).toHaveAttribute(
    'data-active-tab',
    'agents',
  );
});

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
    const items = [
      ...stack.querySelectorAll<HTMLElement>(
        '[data-launcher-preview-item], [data-agent-avatar-overflow]',
      ),
    ].map((item) => {
      const rect = item.getBoundingClientRect();
      const surface = item.querySelector<HTMLElement>(
        '[data-sidebar-launcher-glyph], [data-resource-icon-tile], [data-agent-avatar-with-state]',
      );
      const surfaceRect = surface?.getBoundingClientRect();
      const textNode = item.hasAttribute('data-agent-avatar-overflow')
        ? item
        : item.querySelector<HTMLElement>('span[aria-hidden="true"]');
      const textRect = textNode?.getBoundingClientRect();
      return {
        left: (rect.left - cardRect.left) / scale,
        width: rect.width / scale,
        visibleLeft: surfaceRect ? (surfaceRect.left - cardRect.left) / scale : null,
        visibleWidth: surfaceRect ? surfaceRect.width / scale : null,
        overflow:
          item.hasAttribute('data-sidebar-agent-overflow') ||
          item.hasAttribute('data-sidebar-context-overflow') ||
          item.hasAttribute('data-agent-avatar-overflow'),
        text: textRect?.width ? textNode?.textContent : null,
        textWidth: textRect ? textRect.width / scale : null,
        clientWidth: item.clientWidth,
        scrollWidth: item.scrollWidth,
        inlineWidth: item.style.width,
      };
    });
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
      const expectedTargetSize = launcherId === 'agents' ? 20 : 36;
      const geometry = await inspectLauncher(
        component.locator(`[data-sidebar-launcher="${launcherId}"]`),
      );
      expect(geometry.targetSize).toBe(String(expectedTargetSize));
      expect(geometry.visibleSize).toBe('20');
      expect(geometry.stepSize).toBe('15');
      const visibleItems = geometry.items.filter(({ overflow }) => !overflow);
      const overflow = geometry.items.find((item) => item.overflow)!;
      expect(visibleItems.length).toBeGreaterThan(0);
      expect(
        visibleItems.every(
          ({ width, visibleWidth }) =>
            Math.max(Math.abs(width - expectedTargetSize), Math.abs((visibleWidth ?? 0) - 20)) <=
            TOLERANCE,
        ),
      ).toBe(true);
      expect(Math.abs(visibleItems[0].visibleLeft! - geometry.labelLeft)).toBeLessThanOrEqual(
        TOLERANCE,
      );
      const steps = visibleItems
        .slice(1)
        .map((item, index) => item.left - visibleItems[index].left);
      expect(steps.every((step) => Math.abs(step - 15) <= TOLERANCE)).toBe(true);
      expect(steps.every((step) => Math.abs(20 - step - 5) <= TOLERANCE)).toBe(true);
      expect(overflow.text).toBe(`+${ITEM_COUNT - visibleItems.length}`);
      expect(overflow.inlineWidth).toBe('');
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      expect(overflow.width).toBeGreaterThanOrEqual((overflow.textWidth ?? 0) - TOLERANCE);
    }

    const contextResource = await inspectResource(
      component.locator('[data-sidebar-launcher="context"]'),
    );
    expect(contextResource.leftDelta).toBeLessThanOrEqual(TOLERANCE);
    expect(contextResource.width).toBeCloseTo(20, 1);
    expect(contextResource.height).toBeCloseTo(20, 1);

    const changesLauncher = component.locator('[data-sidebar-launcher="changes"]');
    const changesResource = await inspectResource(changesLauncher);
    expect(changesResource.leftDelta).toBeLessThanOrEqual(2);
    expect(changesResource.width).toBeCloseTo(24, 1);
    expect(changesResource.height).toBeCloseTo(24, 1);
    const changesLabel = changesLauncher.locator('[data-sidebar-launcher-label]');
    const prAction = changesLauncher.locator('[data-sidebar-pr-trigger]');
    await expect(prAction).toHaveCount(1);
    await expect(prAction.locator('svg')).toHaveCount(1);
    await expect(prAction).toHaveAttribute('data-sidebar-pr-count', '1');
    await expect(changesLauncher.locator('[data-sidebar-pr-link]')).toHaveCount(0);
    await prAction.click();
    const prLink = page.locator('[data-sidebar-pr-link]');
    await expect(prLink).toHaveCount(1);
    await expect(prLink).toHaveAttribute(
      'data-sidebar-pr-url',
      'https://github.com/intent-hq/repository-with-a-very-long-name/pull/1373',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-sidebar-pr-link]')).toHaveCount(0);
    const labelBounds = await changesLabel.boundingBox();
    const actionBounds = await prAction.boundingBox();
    expect((actionBounds!.x - (labelBounds!.x + labelBounds!.width)) / scenario.zoom).toBeCloseTo(
      8,
      1,
    );
    await expect(changesLauncher.getByText('PR #', { exact: false })).toHaveCount(0);
    await expect(changesLauncher.getByText('Open', { exact: true })).toHaveCount(0);

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

test('preserves semantic colors in the collapsed agent stack', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const component = await mount(LauncherGeometryHost, {
    props: { width: 480, zoom: 1, theme: 'light', itemCount: 4 },
  });
  const states = ['running', 'waiting', 'failed', 'completed'] as const;
  const colors: string[] = [];

  for (const state of states) {
    const agent = component.locator(`[data-sidebar-agent-state="${state}"]`);
    await expect(agent).toHaveCount(1);
    colors.push(
      await agent
        .locator('[data-agent-avatar-with-state]')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
  }

  expect(new Set(colors).size).toBe(states.length);
});

test('preserves hover, focus, and click behavior without open-panel markers', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(LauncherGeometryHost, {
    props: { width: 480, zoom: 1, theme: 'light', itemCount: ITEM_COUNT },
  });
  const agents = component.locator('[data-sidebar-agent]');
  const notes = component.locator('[data-sidebar-context]');
  await expect(agents).toHaveCount(6);
  await expect(notes).toHaveCount(6);
  await expect(component.locator('[data-panel-open-marker]')).toHaveCount(0);

  await agents.first().hover({ position: { x: 2, y: 18 } });
  // Launcher hover cards require a deliberate 300ms dwell before opening
  // (perf: a mouse pass-over during a workspace switch must not open them).
  await expect(page.locator('[data-sidebar-hover-card="agent"]')).toBeVisible({ timeout: 1000 });
  await notes.first().focus();
  await expect(notes.first()).toBeFocused();
  await expect(page.locator('[data-sidebar-hover-card="note"]')).toBeVisible({ timeout: 1000 });
  await agents.first().focus();
  await page.keyboard.press('Tab');
  await expect(agents.nth(1)).toBeFocused();
  await component.getByTestId('agent-panel-toggle').click();
  await expect(component.locator('[data-sidebar-overlay]')).toBeVisible();
  await expect(component.locator('[data-sidebar-tab-strip]')).toHaveAttribute(
    'data-active-tab',
    'agents',
  );
});

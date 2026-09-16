import { expect, test } from '@playwright/experimental-ct-svelte';
import DaemonStatusIndicatorGeometryHost from './DaemonStatusIndicatorGeometryHost.svelte';

test.use({ viewport: { width: 1000, height: 760 }, reducedMotion: 'reduce' });

for (const remote of [false, true]) {
  test(`keeps the ${remote ? 'remote' : 'local'} header icon unclipped`, async ({
    mount,
    page,
  }) => {
    await mount(DaemonStatusIndicatorGeometryHost, { props: { remote } });
    const trigger = page.getByTestId('daemon-status-fixture').getByRole('button');
    const geometry = await trigger.evaluate((button) => {
      const svg = button.querySelector('svg')!;
      const rect = svg.getBoundingClientRect();
      let visibleWidth = rect.width;
      let visibleHeight = rect.height;
      for (let parent = svg.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
          visibleWidth = Math.min(
            visibleWidth,
            Math.min(rect.right, box.right) - Math.max(rect.left, box.left),
          );
        }
        if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
          visibleHeight = Math.min(
            visibleHeight,
            Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top),
          );
        }
        if (parent === button) break;
      }
      const buttonBox = button.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        visibleWidth,
        visibleHeight,
        centerDelta: Math.abs(rect.top + rect.height / 2 - buttonBox.top - buttonBox.height / 2),
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(12);
    expect(geometry.height).toBeGreaterThanOrEqual(12);
    expect(geometry.visibleWidth).toBeCloseTo(geometry.width, 1);
    expect(geometry.visibleHeight).toBeCloseTo(geometry.height, 1);
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
}

test('top-aligns the details panel and keeps device leading columns stable', async ({
  mount,
  page,
}) => {
  await mount(DaemonStatusIndicatorGeometryHost);
  await page.getByTestId('daemon-status-fixture').getByRole('button').click();
  const parent = page.locator('[data-slot="menu-content"]');
  const local = parent.getByRole('menuitem', { name: /This machine/ });
  const remote = parent.getByRole('menuitem', { name: /Studio fixture/ });
  const manage = parent.getByRole('menuitem', { name: /Manage devices/ });
  const leadingLefts = await Promise.all(
    [local, remote, manage].map((row) =>
      row
        .locator('[data-slot="menu-item-leading"]')
        .evaluate((el) => el.getBoundingClientRect().left),
    ),
  );
  expect(Math.max(...leadingLefts) - Math.min(...leadingLefts)).toBeLessThanOrEqual(1);
  const labels = await Promise.all(
    [local, remote, manage].map((row) =>
      row.evaluate((el) => {
        const range = document.createRange();
        const text =
          Array.from(el.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          ) ?? el.querySelector(':scope > span:not([data-slot])');
        range.selectNodeContents(text!);
        return { left: range.getBoundingClientRect().left, align: getComputedStyle(el).textAlign };
      }),
    ),
  );
  expect(
    Math.max(...labels.map((x) => x.left)) - Math.min(...labels.map((x) => x.left)),
  ).toBeLessThanOrEqual(1);
  for (const label of labels) expect(label.align).toBe('left');
  await expect(remote.locator('[data-connection-accent]')).toBeVisible();
  await expect(local.getByRole('img', { name: /active/i })).toBeVisible();
  await parent.locator('[data-slot="menu-sub-trigger"]').click();
  const details = page.locator('[data-slot="menu-sub-content"]');
  await expect(details).toBeVisible();
  await expect
    .poll(async () => Math.abs((await details.boundingBox())!.y - (await parent.boundingBox())!.y))
    .toBeLessThanOrEqual(1);
  const fonts = await details
    .locator('span')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).fontFamily));
  expect(fonts.length).toBeGreaterThan(10);
  for (const font of fonts) expect(font).not.toMatch(/mono/i);
});

test('keeps details inside a short viewport when parent top alignment would overflow', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 280 });
  await mount(DaemonStatusIndicatorGeometryHost, { props: { bottom: true } });
  await page.getByTestId('daemon-status-fixture').getByRole('button').click();
  await page.locator('[data-slot="menu-sub-trigger"]').click();
  const details = page.locator('[data-slot="menu-sub-content"]');
  await expect(details).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await details.boundingBox())!;
      return box.y >= 7 && box.y + box.height <= 273;
    })
    .toBe(true);
  expect(await details.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test('flips details away from the left edge and supports keyboard return to device actions', async ({
  mount,
  page,
}) => {
  await mount(DaemonStatusIndicatorGeometryHost, { props: { left: true } });
  const trigger = page.getByTestId('daemon-status-fixture').getByRole('button');
  await trigger.focus();
  await trigger.press('ArrowDown');
  const subTrigger = page.locator('[data-slot="menu-sub-trigger"]');
  await expect(subTrigger).toBeFocused();
  await subTrigger.press('ArrowRight');
  const details = page.locator('[data-slot="menu-sub-content"]');
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute('data-side', 'right');
  const parent = page.locator('[data-slot="menu-content"]');
  await expect
    .poll(async () => Math.abs((await details.boundingBox())!.y - (await parent.boundingBox())!.y))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('ArrowLeft');
  await expect(subTrigger).toBeFocused();
  await subTrigger.press('End');
  await expect(parent.getByRole('menuitem', { name: /Manage devices/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

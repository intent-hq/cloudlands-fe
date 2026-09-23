import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import Preview from '../toast-header.preview.svelte';

// Wait for a toast to finish Sonner's enter transition before reading geometry.
async function settle(page: Page, toast: Locator) {
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('data-mounted', 'true');
  await page.evaluate(() => document.fonts.ready);
  await toast.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );
}

const contracts = [
  { status: 'downloaded', width: 320 },
  { status: 'downloaded', width: 420 },
  { status: 'available', width: 420 },
  { status: 'downloading', width: 420 },
  { status: 'error', width: 420 },
  { status: 'standard', width: 420 },
  { status: 'plain', width: 320 },
] as const;

for (const { status, width } of contracts) {
  test(`${status} toast keeps controls in its header at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { status } });
    const toast = page.locator('[data-sonner-toast]');
    await settle(page, toast);
    const geometry = await toast.evaluate((node) => {
      const box = (selector: string) =>
        node.querySelector(selector)?.getBoundingClientRect().toJSON();
      const title = node.querySelector('.title,[data-title]')!;
      return {
        root: node.getBoundingClientRect().toJSON(),
        client: node.clientWidth,
        scroll: node.scrollWidth,
        title: box('.title,[data-title]')!,
        titleLineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
        description: box('.description,[data-description]')!,
        icon: box('.icon-celebrate,[data-toast-glyph]'),
        action: box('.toast-action,[data-button]:not([data-cancel])'),
        close: box('.toast-close-btn,[data-close-button]'),
        cancel: box('[data-cancel]'),
      };
    });
    const controls = [geometry.icon, geometry.action, geometry.close, geometry.cancel].filter(
      Boolean,
    );
    const center = geometry.title.top + geometry.titleLineHeight / 2;
    for (const control of controls) {
      expect(Math.abs(control!.top + control!.height / 2 - center)).toBeLessThanOrEqual(1);
      expect(control!.bottom).toBeLessThan(geometry.description.top);
    }
    expect(geometry.description.left).toBeCloseTo(geometry.title.left, 0);
    expect(geometry.root.left).toBeGreaterThanOrEqual(0);
    expect(geometry.root.right).toBeLessThanOrEqual(width);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    if (geometry.action && geometry.close) {
      expect(geometry.close.left - geometry.action.right).toBeGreaterThanOrEqual(8);
    }
    for (const button of [geometry.action, geometry.close, geometry.cancel].filter(Boolean)) {
      expect(button!.height).toBeGreaterThanOrEqual(24);
      expect(button!.width).toBeGreaterThanOrEqual(24);
    }
    if (status === 'downloaded' || status === 'available' || status === 'standard') {
      const action = toast.getByRole('button', {
        name: status === 'downloaded' ? 'Install' : status === 'available' ? 'Download' : 'Review',
        exact: true,
      });
      await action.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('toast-header-actions')).toHaveText('1');
      if (status === 'standard') await expect(toast).toHaveCount(0);
      else await expect(toast).toBeVisible();
    }
    if (status === 'plain') {
      await toast.getByRole('button', { name: 'Later', exact: true }).click();
      await expect(page.getByTestId('toast-header-dismissals')).toHaveText('1');
      await expect(toast).toHaveCount(0);
    } else if (geometry.close && status !== 'standard') {
      const close = toast.locator('.toast-close-btn,[data-close-button]');
      await close.focus();
      await page.keyboard.press('Space');
      await expect(page.getByTestId('toast-header-dismissals')).toHaveText('1');
      await expect(toast).toHaveCount(0);
    }
  });
}

for (const { status, width } of [
  { status: 'multiline-warning', width: 420 },
  { status: 'multiline-warning', width: 320 },
  { status: 'details', width: 420 },
  { status: 'multiline-details', width: 320 },
] as const) {
  test(`${status} aligns icon and close to its first title line at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { status } });
    const toast = page.locator('[data-sonner-toast]');
    await settle(page, toast);
    const geometry = await toast.evaluate((node) => {
      const title = node.querySelector('[data-title],.toast-title')!;
      const rect = title.getBoundingClientRect();
      const style = getComputedStyle(title);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        firstLineCenter: rect.top + lineHeight / 2,
        lines: Math.round(rect.height / lineHeight),
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight,
        controls: Array.from(
          node.querySelectorAll('[data-toast-glyph],.toast-close-btn,[data-close-button]'),
        ).map((control) => control.getBoundingClientRect().toJSON()),
        root: node.getBoundingClientRect().toJSON(),
        client: node.clientWidth,
        scroll: node.scrollWidth,
      };
    });
    expect(geometry.fontSize).toBe(13);
    expect(geometry.lineHeight).toBeCloseTo(17.55, 1);
    expect(geometry.controls).toHaveLength(2);
    for (const control of geometry.controls) {
      expect(
        Math.abs(control.top + control.height / 2 - geometry.firstLineCenter),
      ).toBeLessThanOrEqual(1);
    }
    expect(geometry.root.left).toBeGreaterThanOrEqual(0);
    expect(geometry.root.right).toBeLessThanOrEqual(width);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    if (status === 'multiline-warning') {
      expect(geometry.lines).toBeGreaterThanOrEqual(4);
      await expect(toast.locator('[data-description]')).toHaveCount(0);
    } else {
      expect(geometry.lines).toBe(status === 'details' ? 1 : 3);
      const disclosure = toast.locator('details');
      await expect(disclosure).not.toHaveAttribute('open');
      await disclosure.locator('summary').press('Enter');
      await expect(disclosure).toHaveAttribute('open');
      await expect(disclosure.locator('pre')).toBeVisible();
      await expect(disclosure.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
      await disclosure.locator('summary').press('Space');
      await expect(disclosure).not.toHaveAttribute('open');
    }
    await toast.locator('.toast-close-btn,[data-close-button]').press('Enter');
    await expect(toast).toHaveCount(0);
  });
}

test('keeps a component undo action beside its title', async ({ mount, page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { status: 'undo' } });
  const toast = page.locator('[data-sonner-toast]');
  const action = toast.getByRole('button', { name: /Undo/ });
  await expect(action).toBeVisible();
  await settle(page, toast);
  // Read title and action in one frame so the two rects share a layout.
  const { a, b, lineHeight } = await toast.evaluate((node) => {
    const title = node.querySelector('[data-title]')!;
    const undo = Array.from(node.querySelectorAll('button')).find((button) =>
      /Undo/.test(button.textContent ?? ''),
    )!;
    return {
      a: title.getBoundingClientRect().toJSON(),
      b: undo.getBoundingClientRect().toJSON(),
      lineHeight: Number.parseFloat(getComputedStyle(title).lineHeight),
    };
  });
  expect(Math.abs(a.y + lineHeight / 2 - b.y - b.height / 2)).toBeLessThanOrEqual(1);
  expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(8);
  await toast.getByRole('button', { name: /Close|Dismiss/i }).press('Enter');
  await expect(toast).toHaveCount(0);
});

test('preserves collapsed standard copy and both actions without a visible stack count', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { status: 'plain', stacked: true } });
  const front = page.locator('[data-sonner-toast][data-front="true"]');
  const rear = page.locator('[data-sonner-toast][data-front="false"]');
  await settle(page, front);
  await expect(rear.locator('[data-title]')).toHaveCSS('opacity', '0');
  await expect(rear.locator('[data-description]')).toHaveCSS('opacity', '0');
  await expect(rear.locator('[data-description]')).toHaveCSS('pointer-events', 'none');
  const fits = await front.evaluate((node) => {
    const title = node.querySelector('[data-title]')!.getBoundingClientRect();
    const cancel = node.querySelector('[data-cancel]')!.getBoundingClientRect();
    return title.right < cancel.left && node.scrollWidth <= node.clientWidth;
  });
  expect(fits).toBe(true);
  await expect(page.getByText(/^\d+ more$/)).toHaveCount(0);
  await front.hover();
  await expect(rear).toHaveAttribute('data-expanded', 'true');
  await expect(rear.locator('[data-title]')).toHaveCSS('opacity', '1');
  await expect(rear.locator('[data-description]')).toHaveCSS('opacity', '1');
  await front.getByRole('button', { name: 'Later', exact: true }).press('Enter');
  await expect(page.getByTestId('toast-header-dismissals')).toHaveText('1');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  await expect(page.locator('[data-toast-stack-count]')).toHaveCount(0);
});

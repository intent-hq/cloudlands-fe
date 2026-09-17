import { expect, test } from '@playwright/experimental-ct-svelte';
import FilesOpenMenuPreview from '../files-open-menu.preview.svelte';
import {
  measureCollapsedFilesTrigger,
  measureInlinePath,
  measureTextTrigger,
} from './files-open-menu.assertions';

test('Files menu has aligned icon and label slots for different label lengths', async ({
  mount,
  page,
}) => {
  const component = await mount(FilesOpenMenuPreview);
  await component.locator('p').getByRole('button').click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveCount(5);
  const rows = await items.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const icon = element
        .querySelector('[data-slot="menu-item-leading"]')!
        .getBoundingClientRect();
      const label = element
        .querySelector('[data-slot="menu-item-leading"] + span')!
        .getBoundingClientRect();
      const shortcut = element.querySelector('kbd')?.getBoundingClientRect();
      return {
        x: icon.x,
        labelX: label.x,
        height: bounds.height,
        centerDelta: Math.abs(icon.y + icon.height / 2 - bounds.y - bounds.height / 2),
        iconWidth: icon.width,
        labelRight: label.right,
        shortcutX: shortcut?.x,
      };
    }),
  );
  expect(
    Math.max(...rows.map((row) => row.x)) - Math.min(...rows.map((row) => row.x)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...rows.map((row) => row.labelX)) - Math.min(...rows.map((row) => row.labelX)),
  ).toBeLessThanOrEqual(1);
  for (const row of rows) {
    expect(row.height).toBeGreaterThanOrEqual(28);
    expect(row.centerDelta).toBeLessThanOrEqual(1);
    expect(row.labelX - row.x - row.iconWidth).toBeGreaterThanOrEqual(6);
    if (row.shortcutX) expect(row.labelRight).toBeLessThanOrEqual(row.shortcutX);
  }
  await page.keyboard.press('Escape');
  await expect(component.locator('p').getByRole('button')).toBeFocused();
});

test('Files menu keyboard navigation executes each mock action once and restores focus', async ({
  mount,
  page,
}) => {
  const component = await mount(FilesOpenMenuPreview);
  const trigger = component.locator('p').getByRole('button');
  const items = page.getByRole('menuitem');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const expected = [
    {
      channel: 'shell:showItemInFolder',
      args: [{ path: '/tmp/intent-demo/worktrees/sample-project' }],
    },
    { channel: 'vscode:open', args: ['/tmp/intent-demo/worktrees/sample-project'] },
    {
      channel: 'external-editors:open',
      args: [{ editorId: 'warp', path: '/tmp/intent-demo/worktrees/sample-project' }],
    },
    {
      channel: 'external-editors:open-with-other',
      args: [{ path: '/tmp/intent-demo/worktrees/sample-project' }],
    },
    { channel: 'clipboard:writeText', args: ['/tmp/intent-demo/worktrees/sample-project'] },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    await page.keyboard.press('Space');
    await page.keyboard.press('Home');
    for (let step = 0; step < index; step += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(async () => JSON.parse(await component.getByTestId('files-menu-requests').innerText()))
      .toEqual(expected.slice(0, index + 1));
  }
});

for (const config of [
  { name: 'normal', width: 360, fontSize: 16 },
  { name: 'narrow', width: 248, fontSize: 16 },
  { name: 'user font scaling', width: 300, fontSize: 20 },
]) {
  test(`Files inline path inherits prose metrics and wraps punctuation at ${config.name}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(FilesOpenMenuPreview, { props: config });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await component.locator('p').evaluate(measureInlinePath);
    expect(metrics.fontSize).toBeCloseTo(config.fontSize * 0.9375, 2);
    expect(metrics.triggerFont).toBe(metrics.fontSize);
    expect(metrics.triggerLine).toBe(metrics.lineHeight);
    expect(metrics.triggerFamily).toBe(metrics.family);
    expect(metrics.lineHeight / metrics.fontSize).toBeGreaterThan(1.2);
    expect(metrics.lineHeight / metrics.fontSize).toBeLessThan(1.4);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    for (const line of metrics.lines)
      expect(line.right).toBeLessThanOrEqual(metrics.paragraphRight + 1);
    expect(Math.abs(metrics.period.y - metrics.beforePeriod.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.period.x - metrics.beforePeriod.right)).toBeLessThanOrEqual(1);
  });
}

for (const mode of ['remote', 'web'] as const) {
  test(`${mode} Files path stays a single copy action for pointer, Enter and Space`, async ({
    mount,
    page,
  }) => {
    const component = await mount(FilesOpenMenuPreview, { props: { mode } });
    const trigger = component.locator('p').getByRole('button');
    await trigger.click();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).not.toHaveAttribute('aria-haspopup');
    await expect
      .poll(async () => JSON.parse(await component.getByTestId('files-menu-requests').innerText()))
      .toEqual(
        Array.from({ length: 3 }, () => ({
          channel: 'clipboard:writeText',
          args: ['/tmp/intent-demo/worktrees/sample-project'],
        })),
      );
  });
}

test('embedded menu preserves the production submenu and launch routing', async ({
  mount,
  page,
}) => {
  const component = await mount(FilesOpenMenuPreview, { props: { surface: 'embedded' } });
  await component.getByRole('button', { name: 'File actions' }).click();
  await page.getByRole('menuitem', { name: /Open in/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('menuitem', { name: 'Visual Studio Code' }).click();
  await expect
    .poll(async () => JSON.parse(await component.getByTestId('files-menu-requests').innerText()))
    .toEqual([{ channel: 'vscode:open', args: ['/tmp/intent-demo/worktrees/sample-project'] }]);
});

test('onboarding-style inline trigger retains inherited type and keyboard menu interaction', async ({
  mount,
  page,
}) => {
  const component = await mount(FilesOpenMenuPreview, { props: { surface: 'inline' } });
  const trigger = component.locator('p').getByRole('button');
  const metrics = await trigger.evaluate((element) => ({
    font: getComputedStyle(element).fontSize,
    parentFont: getComputedStyle(element.closest('p')!).fontSize,
    line: getComputedStyle(element).lineHeight,
    parentLine: getComputedStyle(element.closest('p')!).lineHeight,
  }));
  expect(metrics.font).toBe(metrics.parentFont);
  expect(metrics.line).toBe(metrics.parentLine);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('setup-card sidebar text trigger sizes to its path label instead of an icon box', async ({
  mount,
  page,
}) => {
  const component = await mount(FilesOpenMenuPreview, { props: { surface: 'setup-card' } });
  const trigger = component.locator('p').getByRole('button');
  await page.evaluate(() => document.fonts.ready);
  const metrics = await trigger.evaluate(measureTextTrigger);
  expect(metrics.textWidth).toBeGreaterThan(28);
  expect(metrics.width).toBeGreaterThanOrEqual(metrics.textWidth);
  expect(metrics.labelOverflow).toBeLessThanOrEqual(1);
  expect(metrics.scrollOverflow).toBeLessThanOrEqual(1);
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

for (const width of [360, 248]) {
  test(`collapsed Files launcher is a transparent aligned action at ${width}px`, async ({
    mount,
    page,
  }) => {
    const component = await mount(FilesOpenMenuPreview, {
      props: { surface: 'collapsed', width },
    });
    const files = component.locator('[data-sidebar-launcher="files"]');
    const trigger = files.getByRole('button', { name: /Open in/ });
    await page.evaluate(() => document.fonts.ready);
    const assertGeometry = async () => {
      const metrics = await trigger.evaluate(measureCollapsedFilesTrigger);
      expect(metrics.width).toBe(28);
      expect(metrics.height).toBe(28);
      expect(metrics.iconWidth).toBe(16);
      expect(metrics.iconHeight).toBe(16);
      expect(Math.abs(metrics.rightInset)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.centerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.centerY)).toBeLessThanOrEqual(1);
      expect(metrics.padding).toEqual(['0px', '0px']);
      expect(metrics.backgrounds.every((color) => color === 'rgba(0, 0, 0, 0)')).toBe(true);
    };
    await page.mouse.move(0, 0);
    await assertGeometry();
    await trigger.hover();
    await assertGeometry();
    await page.mouse.down();
    await assertGeometry();
    await page.mouse.up();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    const focus = await trigger.evaluate(measureCollapsedFilesTrigger);
    expect(focus.focusVisible).toBe(true);
    expect(focus.outline).not.toBe('none');
    expect(focus.outlineWidth).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(async () => JSON.parse(await component.getByTestId('files-menu-requests').innerText()))
      .toEqual([{ channel: 'vscode:open', args: ['/tmp/intent-demo/worktrees/sample-project'] }]);
    await expect(files).toBeVisible();

    const changes = component.locator('[data-sidebar-launcher="changes"]');
    await expect(changes.locator('[data-sidebar-launcher-icons] svg')).toHaveCount(0);
    const cards = await Promise.all([files.boundingBox(), changes.boundingBox()]);
    expect(cards[1]!.height).toBe(cards[0]!.height);
    expect(cards[1]!.y).toBe(cards[0]!.y);
  });
}

import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceAgentsListGeometryHarness from './mocks/WorkspaceAgentsListGeometryHarness.svelte';

const platformModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

for (const zoom of [1, 2]) {
  test(`keeps Agents-panel rename fully text-editable at ${zoom * 100}%`, async ({
    mount,
    page,
  }) => {
    const component = await mount(WorkspaceAgentsListGeometryHarness, {
      props: { width: 300, zoom },
    });
    const row = component.locator('[data-agent-panel-row="long-name"]');
    await expect(component.locator('[data-selected-agent]')).toHaveAttribute(
      'data-selected-agent',
      'coordinator',
    );

    await row.click({ button: 'right' });
    await page.getByText('Rename', { exact: true }).click();
    const input = component.getByRole('textbox', { name: 'Rename' });
    await expect(input).toBeFocused();
    await expect(row).toHaveJSProperty('tagName', 'DIV');
    await expect(row.locator('button')).toHaveCount(0);

    const name = 'Alpha  Beta  42!?';
    await page.keyboard.type(name);
    await expect(input).toHaveValue(name);
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    await page.keyboard.type('A');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('?');
    await expect(input).toHaveValue(name);

    await input.selectText();
    await page.keyboard.press(`${platformModifier}+c`);
    await page.keyboard.press(`${platformModifier}+x`);
    await expect(input).toHaveValue('');
    await page.keyboard.press(`${platformModifier}+v`);
    await expect(input).toHaveValue(name);
    await page.keyboard.press(`${platformModifier}+z`);
    await expect(input).toHaveValue('');
    await page.keyboard.press(`${platformModifier}+Shift+z`);
    await expect(input).toHaveValue(name);

    await input.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    await expect(input).toBeVisible();
    await input.click({ position: { x: 8, y: 8 } });
    await expect(component.locator('[data-selected-agent]')).toHaveAttribute(
      'data-selected-agent',
      'coordinator',
    );

    await page.keyboard.press('Enter');
    await expect(row.getByTestId('agent-card-name')).toHaveText(name);
    await expect(component.locator('[data-selected-agent]')).toHaveAttribute(
      'data-selected-agent',
      'coordinator',
    );

    await row.click({ button: 'right' });
    await page.getByText('Rename', { exact: true }).click();
    await input.fill('Cancelled rename');
    await page.keyboard.press('Escape');
    await expect(row.getByTestId('agent-card-name')).toHaveText(name);
  });
}

test('keeps narrow 200% Agents-panel rows single-line and collision-free', async ({ mount }) => {
  const component = await mount(WorkspaceAgentsListGeometryHarness, {
    props: { width: 220, zoom: 2 },
  });

  const previewNodes = component.locator(
    '[data-testid="agent-card-preview"], [data-testid="agent-card-preview-row"], [data-testid="agent-card-attention"]',
  );
  await expect(previewNodes).toHaveCount(0);
  await component.locator('[data-agent-delegation-toggle="coordinator"]').click();
  await component.locator('[data-agent-background-toggle]').click();

  const rows = component.locator('[data-agent-panel-row]');
  await expect(rows).toHaveCount(5);
  for (const row of await rows.all()) {
    const rowBox = await row.boundingBox();
    expect(rowBox?.height).toBe(80);
    const avatar = row.locator('[data-agent-avatar-with-state]');
    await expect(avatar).toHaveAttribute('data-avatar-variant', 'emphasized');
    const avatarGeometry = await avatar.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.width,
        height: style.height,
        background: style.backgroundColor,
        box: node.getBoundingClientRect().toJSON(),
      };
    });
    expect(avatarGeometry.width).toBe('24px');
    expect(avatarGeometry.height).toBe('24px');
    expect(avatarGeometry.box.width).toBe(48);
    expect(avatarGeometry.box.height).toBe(48);
    expect(avatarGeometry.background).not.toBe('rgba(0, 0, 0, 0)');

    const geometry = await row.evaluate((node) => {
      const name = node.querySelector('[data-agent-row-name]')!.getBoundingClientRect();
      const trailing = node.querySelector('[data-agent-row-trailing]')!.getBoundingClientRect();
      const rowRect = node.getBoundingClientRect();
      const nameStyle = getComputedStyle(node.querySelector('[data-agent-row-name]')!);
      const trailingStyle = getComputedStyle(node.querySelector('[data-agent-row-trailing]')!);
      return {
        nameRight: name.right,
        trailingLeft: trailing.left,
        trailingRight: trailing.right,
        rowRight: rowRect.right,
        nameOverflow: nameStyle.overflow,
        trailingShrink: trailingStyle.flexShrink,
      };
    });
    expect(geometry.nameRight).toBeLessThanOrEqual(geometry.trailingLeft + 0.5);
    expect(geometry.trailingRight).toBeLessThanOrEqual(geometry.rowRight + 0.5);
    expect(geometry.nameOverflow).toBe('hidden');
    expect(geometry.trailingShrink).toBe('0');
  }

  const longRow = component.locator('[data-agent-panel-row="long-name"]');
  await longRow.focus();
  await expect(longRow).toBeFocused();
  await longRow.press('Enter');
  await expect(component.locator('[data-selected-agent]')).toHaveAttribute(
    'data-selected-agent',
    'long-name',
  );
  await expect(longRow.locator('[data-panel-open-state="active"]')).toHaveCount(1);
  await expect(longRow.locator('[data-agent-row-time]')).toHaveCount(1);
  await expect(
    component.locator('[data-agent-panel-row="background-active"] [data-agent-background-badge]'),
  ).toHaveCount(1);

  await component.locator('[data-agent-search]').fill('delegated search target');
  await expect(component.locator('[data-agent-panel-row="coordinator"]')).toHaveCount(1);
  await expect(component.locator('[data-agent-panel-row="delegated-search-target"]')).toHaveCount(
    1,
  );
  await expect(component.locator('[data-agent-panel-row="long-name"]')).toHaveCount(0);
});

test('keeps virtualized Agents-panel slots aligned to the same row height', async ({ mount }) => {
  const component = await mount(WorkspaceAgentsListGeometryHarness, {
    props: { width: 220, zoom: 2, virtual: true },
  });
  const slots = component.locator('[data-index]');
  await expect(slots.first()).toBeVisible();
  for (const slot of await slots.all()) {
    expect(await slot.evaluate((node) => getComputedStyle(node).height)).toBe('40px');
    expect((await slot.boundingBox())?.height).toBe(80);
  }
  await expect(component.locator('[data-testid="agent-card-preview"]')).toHaveCount(0);
});

import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceAgentsListGeometryHarness from './mocks/WorkspaceAgentsListGeometryHarness.svelte';

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

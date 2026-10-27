import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('row feedback targets each workspace and Assistant without companion menus or footer', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const props = dockRailPreview.states.notch.props;
  const items = props.workspaces.slice(0, 2);
  const component = await mount(DockRailPreview, { props: { ...props, workspaces: items } });
  await expect(component.getByTestId('dock-update-count')).toHaveAccessibleName(/Failed/);
  await expect(
    component.getByTestId('dock-update-count').locator('[data-workspace-status="failed"]'),
  ).toBeVisible();
  await component.getByTestId('dock-drag-handle').hover();
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'true');
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  const overview = component.getByTestId('dock-overview');
  const pens = overview.getByTestId('dock-row-feedback');
  await expect(
    overview.locator('[data-workspace-id="dock:assistant"] [data-dock-status-badge]'),
  ).toHaveCount(0);
  for (const [index, status] of ['failed', 'blocked'].entries()) {
    const row = overview.locator(
      `[data-dock-row][data-workspace-id="${items[index].workspace.id}"]`,
    );
    await expect(
      row.locator(`[data-dock-status-badge] [data-workspace-status="${status}"]`),
    ).toBeVisible();
    await expect(row).toHaveAccessibleDescription(index === 0 ? /Failed/ : /Blocked/);
  }
  await expect(pens).toHaveCount(3);
  await expect(pens.first()).toHaveCSS('opacity', '0');
  await expect(pens.first()).toHaveCSS('pointer-events', 'none');
  await component
    .getByTestId('dock-surface')
    .screenshot({ path: testInfo.outputPath('row-feedback-idle.png') });
  const hoverEvidence: unknown[] = [];
  const actions: string[] = [];
  for (const item of items) {
    const id = String(item.workspace.id);
    const pen = overview.locator(`[data-testid="dock-row-feedback"][data-workspace-id="${id}"]`);
    const hoverRow = overview.locator(`[data-dock-row][data-workspace-id="${id}"]`);
    await hoverRow.hover();
    await expect(pen).toHaveCSS('opacity', '1');
    await expect(pen).toHaveCSS('pointer-events', 'auto');
    await expect(hoverRow).toHaveCSS('cursor', 'pointer');
    await expect(pen).toHaveCSS('cursor', 'pointer');
    const rowBackground = await hoverRow.evaluate(
      (el) => getComputedStyle(el.closest('.overview-row') ?? el).backgroundColor,
    );
    await pen.hover();
    const penBackground = await pen.evaluate(
      (el) =>
        getComputedStyle(el.querySelector('[data-slot="button-surface"]') ?? el).backgroundColor,
    );
    // The shared Button owns hover paint; the dock must expose an unobstructed target.
    expect(
      await pen.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2),
        );
      }),
    ).toBe(true);
    hoverEvidence.push({ id, rowBackground, penBackground });
    await pen.click();
    await expect(component).toHaveAttribute('data-preview-action', `feedback:${id}`);
    actions.push(`feedback:${id}`);
    await expect(component).toHaveAttribute('data-preview-actions', JSON.stringify(actions));
    await component.getByTestId('dock-drag-handle').hover();
    await expect(pen).toHaveCSS('opacity', '0');
    await expect(pen).toHaveCSS('pointer-events', 'none');
    const row = overview.locator(`[data-dock-row][data-workspace-id="${id}"]`);
    await row.click();
    await expect(component).toHaveAttribute('data-preview-action', `workspace:${id}`);
    actions.push(`workspace:${id}`);
    await row.click({ button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await row.press('Shift+F10');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  const assistant = overview.locator(
    '[data-testid="dock-row-feedback"][data-workspace-id="dock:assistant"]',
  );
  await expect(assistant).toHaveAccessibleName('Give feedback: Assistant');
  await component.getByTestId('dock-drag-handle').hover();
  await page.keyboard.press('Tab');
  await assistant.focus();
  await expect(assistant).toHaveCSS('opacity', '1');
  await expect(assistant).toHaveCSS('pointer-events', 'auto');
  await assistant.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', 'feedback:__chief__');
  actions.push('feedback:__chief__');
  const firstPen = overview.locator(
    `[data-testid="dock-row-feedback"][data-workspace-id="${items[0].workspace.id}"]`,
  );
  await firstPen.focus();
  await firstPen.press('Space');
  await expect(component).toHaveAttribute(
    'data-preview-action',
    `feedback:${items[0].workspace.id}`,
  );
  await overview.locator('[data-dock-row][data-workspace-id="dock:assistant"]').click();
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  await expect(component.getByTestId('dock-feedback')).toHaveCount(0);
  await expect(component.getByTestId('dock-overview-footer')).toHaveCount(0);
  await expect(component.locator('button[aria-haspopup="menu"]')).toHaveCount(0);
  await expect(component.getByTestId('dock-dismiss')).toHaveCount(0);
  await expect(component.getByTestId('dock-drag-handle')).toBeVisible();
  const geometry = await overview.evaluate((el) => {
    const lastRow = el.querySelector('.overview-row:last-child');
    if (!lastRow) throw new Error('Expected a workspace row');
    const last = lastRow.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { overview: r.toJSON(), lastRow: last.toJSON(), bottomGap: r.bottom - last.bottom };
  });
  expect(geometry.bottomGap).toBeLessThanOrEqual(12);
  expect(geometry.bottomGap).toBeGreaterThanOrEqual(0);
  const png = testInfo.outputPath('row-feedback.png');
  await overview.locator(`[data-dock-row][data-workspace-id="${items[0].workspace.id}"]`).hover();
  await component.getByTestId('dock-surface').screenshot({ path: png, animations: 'disabled' });
  await firstPen.hover();
  await component.getByTestId('dock-surface').screenshot({
    path: testInfo.outputPath('row-feedback-pen.png'),
    animations: 'disabled',
  });
  const json = testInfo.outputPath('row-feedback.json');
  await writeFile(
    json,
    JSON.stringify(
      {
        actions,
        hoverEvidence,
        geometry,
        source:
          'production DockRail/AdaptiveDockShell/DockOverview with preview callbacks only; no native capture, delivery or microphone',
      },
      null,
      2,
    ),
  );
  await testInfo.attach('Row feedback screenshot', { path: png, contentType: 'image/png' });
  await testInfo.attach('Row feedback evidence', { path: json, contentType: 'application/json' });
});

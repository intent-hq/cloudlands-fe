import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import { DOCK_PREVIEW_GAP } from '$shared/dock-layout';

// Recovered from the earlier dock's host-geometry browser flow. Each named scene
// produces an attached PNG, so the combined gate leaves repeatable visual proof.
for (const scene of ['light', 'dark', 'narrow', 'overflow'] as const) {
  test(`${scene} dock keeps previews inside its host and passive to input`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 760 });
    await page.emulateMedia({
      reducedMotion: 'reduce',
      colorScheme: scene === 'dark' ? 'dark' : 'light',
    });
    const component = await mount(DockRailPreview, { props: dockRailPreview.states[scene].props });
    const strip = (await component.getByTestId('dock-collapsed-hit-strip').boundingBox())!;
    await page.mouse.move(strip.x + strip.width - 1, strip.y + strip.height / 2);
    await expect(component.getByTestId('dock-rail-target')).toHaveAttribute(
      'data-expanded',
      'true',
    );
    const button = component.locator('button[data-workspace-id]').first();
    await button.hover();
    const preview = component.getByTestId('dock-preview');
    await expect(preview).toBeVisible();
    const [hostBox, railBox, previewBox] = await Promise.all([
      component.boundingBox(),
      component.getByTestId('dock-rail').boundingBox(),
      preview.boundingBox(),
    ]);
    expect(previewBox!.x).toBeGreaterThanOrEqual(hostBox!.x);
    expect(previewBox!.y).toBeGreaterThanOrEqual(hostBox!.y);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width);
    expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(hostBox!.y + hostBox!.height);
    expect(railBox!.x - previewBox!.x - previewBox!.width).toBe(DOCK_PREVIEW_GAP);
    await expect(preview).toHaveAttribute('inert', '');
    if (scene === 'overflow') {
      await expect(component.getByTestId('dock-overflow')).toHaveCount(0);
      await expect(component.locator('[data-dock-entry]')).toHaveCount(
        dockRailPreview.states.overflow.props.workspaces.length + 1,
      );
    }
    const artifact = testInfo.outputPath(`dock-${scene}.png`);
    await component.screenshot({ path: artifact, animations: 'disabled' });
    await testInfo.attach(`Dock ${scene}`, { path: artifact, contentType: 'image/png' });
  });
}

test('Assistant and every workspace remain reachable in the bounded legacy rail', async ({
  mount,
  page,
}) => {
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.overflow.props });
  const assistant = component.locator('[data-dock-assistant]');
  await assistant.focus();
  await assistant.press('Enter');
  await expect(component).toHaveAttribute('data-preview-action', 'assistant');
  const workspace = component.locator('[data-workspace-id]').first();
  await workspace.focus();
  await workspace.press('Enter');
  await expect(component).toHaveAttribute(
    'data-preview-action',
    `workspace:${await workspace.getAttribute('data-workspace-id')}`,
  );
  await workspace.press('End');
  const last = component.locator('button[data-workspace-id]').last();
  await expect(last).toBeFocused();
  const scroller = component.locator('[data-dock-scroll]');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      last.evaluate((el) => {
        const scroll = el.closest('[data-dock-scroll]');
        if (!scroll) return false;
        const r = el.getBoundingClientRect(),
          s = scroll.getBoundingClientRect();
        return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
      }),
    )
    .toBe(true);
  await expect(component.getByTestId('dock-overflow')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(component).toHaveAttribute(
    'data-preview-action',
    `workspace:${await last.getAttribute('data-workspace-id')}`,
  );
  await last.press('Home');
  await expect(assistant).toBeFocused();
  await scroller.hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(assistant).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'false');
  // A queued wheel scroll can move another row beneath the stationary pointer.
  // Dismissal must survive that scroll, until a deliberate pointer re-entry.
  await expect
    .poll(() =>
      scroller.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
    )
    .toBeLessThanOrEqual(1);
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'false');
  await expect(assistant).not.toBeFocused();
  await page.mouse.move(0, 0);
  const strip = (await component.getByTestId('dock-collapsed-hit-strip').boundingBox())!;
  await page.mouse.move(strip.x + strip.width - 1, strip.y + strip.height / 2);
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'true');
  await assistant.focus();
  await expect(assistant).toBeFocused();
  await assistant.press('Escape');
  await expect(component.getByTestId('dock-rail-target')).toHaveAttribute('data-expanded', 'false');
});

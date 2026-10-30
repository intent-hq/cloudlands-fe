import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import ConversationWireHarness from './DockConversationWireHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

/**
 * Dock workspace avatars use the app's stateful avatar (state tints the avatar itself),
 * in the overview rows, the side rail and the conversation header. Screenshots go to
 * .intent/artifacts/dock-avatars-<phase>-*.png.
 */
const PHASE = process.env.DOCK_AVATARS_PHASE ?? 'after';
const ARTIFACTS = resolve(process.cwd(), '../../.intent/artifacts');

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await mkdir(ARTIFACTS, { recursive: true });
});

test('notch overview rows show the app avatar state', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.notch.props });
  await component.getByTestId('dock-drag-handle').hover();
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  const overview = component.getByTestId('dock-overview');
  await overview.screenshot({ path: resolve(ARTIFACTS, `dock-avatars-${PHASE}-notch-rows.png`) });
  if (PHASE === 'before') return;
  const avatars = overview.locator('[data-dock-row] [data-agent-avatar-with-state]');
  await expect(avatars.first()).toBeVisible();
  // The state is shown by the avatar itself: no separate status dot remains.
  await expect(overview.locator('[data-dock-row] [data-dock-status-badge]')).toHaveCount(0);
  // A failed workspace's avatar takes the app's failed state and names it.
  const failed = overview.locator('[data-dock-row] [data-workspace-status="failed"]').first();
  await expect(failed.locator('[data-agent-avatar-with-state]')).toHaveAttribute(
    'data-avatar-state',
    'failed',
  );
  await expect(failed.locator('[data-agent-avatar-with-state]')).toHaveAttribute(
    'aria-label',
    /.+/,
  );
});

test('side rail entries show the app avatar state', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  const component = await mount(DockRailPreview, {
    props: dockRailPreview.states['side-right'].props,
  });
  const rail = component.getByRole('navigation', { name: 'Active spaces' });
  await expect(rail).toBeVisible();
  await rail.screenshot({ path: resolve(ARTIFACTS, `dock-avatars-${PHASE}-side-rail.png`) });
  if (PHASE === 'before') return;
  await expect(component.locator('[data-dock-entry] [data-dock-status-badge]')).toHaveCount(0);
  await expect(
    component.locator('[data-dock-entry] [data-agent-avatar-with-state]').first(),
  ).toBeVisible();
});

for (const chrome of ['notch', 'panel'] as const) {
  test(`conversation header avatar shows the app avatar state (${chrome})`, async ({ mount }) => {
    const component = await mount(ConversationWireHarness, {
      props: { width: 420, height: 320, notchChrome: chrome === 'notch' },
    });
    const header = component.locator('[data-dock-chrome]').first();
    await expect(header).toBeVisible();
    await header.screenshot({
      path: resolve(ARTIFACTS, `dock-avatars-${PHASE}-header-${chrome}.png`),
    });
    if (PHASE === 'before') return;
    await expect(header.locator('[data-dock-status-badge]')).toHaveCount(0);
    await expect(header.locator('[data-dock-header-avatar] [data-agent-avatar]')).toBeVisible();
  });
}

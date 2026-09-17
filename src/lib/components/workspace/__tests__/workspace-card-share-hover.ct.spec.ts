/**
 * Regression (fe#2440 verifier): the hover card must stay reachable with a
 * real pointer in the real wrapper. WorkspaceCard portals the card beside the
 * row; leaving the row toward the card must not dismiss it, and a pointer
 * resting in the card outranks the row losing focus. The card carries no
 * controls of its own (sharing lives in the workspace ⋯ menu and who is
 * present in the sidebar's presence row), so the surface itself is driven.
 */
import { expect, test, type MountResult } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import WorkspaceCardShareHoverHarness from './mocks/WorkspaceCardShareHoverHarness.svelte';

async function enterCardFromRow(page: Page, component: MountResult) {
  const row = component.locator('[data-workspace-card-row]');
  await row.hover();
  const surface = page.locator('[data-workspace-card-hover-surface]');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-summary]')).toBeVisible();
  await moveInSteps(page, row, surface);
  await expect(surface).toBeVisible();
  return { row, surface };
}

async function moveInSteps(page: Page, from: Locator, to: Locator) {
  const [a, b] = await Promise.all([from.boundingBox(), to.boundingBox()]);
  if (!a || !b) throw new Error('row and hover card must both be laid out');
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + 24, y: b.y + 24 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.move(end.x, end.y, { steps: 10 });
}

test('the card stays open while the pointer travels from the row into it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'travel' },
  });
  const { surface } = await enterCardFromRow(page, component);

  await expect(surface.locator('[data-workspace-hover-card-people]')).toHaveCount(0);
  await expect(surface.getByRole('button')).toHaveCount(0);
});

// Pointer parked far from the row and card so only focus drives the surface.
const OUTSIDE = { x: 880, y: 380 };

async function openCardFromKeyboard(page: Page, component: MountResult) {
  await page.mouse.move(OUTSIDE.x, OUTSIDE.y);
  const trigger = component.locator('[data-workspace-card-trigger]');
  await trigger.focus();
  const surface = page.locator('[data-workspace-card-hover-surface]');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-summary]')).toBeVisible();
  return { trigger, surface, outside: component.locator('[data-share-hover-outside]') };
}

test('keyboard: focusing the row opens the card and a genuine blur dismisses it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'kbd' },
  });
  const { trigger, surface } = await openCardFromKeyboard(page, component);

  await trigger.blur();
  await expect(surface).toHaveCount(0);
});

test('focus outside while the pointer rests in the card keeps it; leaving with the pointer then closes it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'mixed-exit' },
  });
  const { surface, outside } = await openCardFromKeyboard(page, component);

  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + 24, { steps: 5 });
  await outside.focus();
  await page.waitForTimeout(300);
  await expect(surface).toBeVisible();

  await page.mouse.move(OUTSIDE.x, OUTSIDE.y, { steps: 10 });
  await expect(surface).toHaveCount(0);
});

test('leaving both the row and the card still dismisses it', async ({ mount, page }) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'dismiss' },
  });
  const { row, surface } = await enterCardFromRow(page, component);

  // Straight down from the row: below the single row, left of the card.
  const rowBox = (await row.boundingBox())!;
  await page.mouse.move(rowBox.x + 8, rowBox.y + rowBox.height + 200, { steps: 10 });
  await expect(surface).toHaveCount(0);
});

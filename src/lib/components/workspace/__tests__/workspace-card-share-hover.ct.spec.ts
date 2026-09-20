/**
 * Regression (fe#2440 verifier): the owner's hover-card Remove controls must
 * be reachable with a real pointer in the real wrapper. WorkspaceCard portals
 * the card beside the row; leaving the row toward the card must not dismiss
 * it, and pressing its controls must not count as an outside click.
 *
 * Sagas do not run in the CT bundle, so the mutation the confirm step
 * dispatches is observed as the reducer-owned in-flight marker rather than a
 * wire call. Share… is not on the card (it lives in the workspace ⋯ menu).
 */
import { expect, test, type MountResult } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import WorkspaceCardShareHoverHarness from './mocks/WorkspaceCardShareHoverHarness.svelte';

async function enterCardFromRow(page: Page, component: MountResult) {
  const row = component.locator('[data-workspace-card-row]');
  await row.hover();
  const surface = page.locator('[data-workspace-card-hover-surface]');
  await expect(surface).toBeVisible();
  const members = surface.locator('[data-workspace-hover-card-members]');
  await expect(members.locator('[data-workspace-hover-card-member-row]')).toHaveCount(2);
  await moveInSteps(page, row, surface);
  await expect(surface).toBeVisible();
  return { row, surface, members, state: component.locator('[data-share-hover-state]') };
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
  const { surface, state } = await enterCardFromRow(page, component);

  await expect(surface.getByRole('button', { name: 'Remove bob' })).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-share]')).toHaveCount(0);
  await expect(state).toHaveAttribute('data-member-count', '2');
});

test('first Remove asks for confirmation and Cancel dispatches no removal', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'cancel' },
  });
  const { surface, members, state } = await enterCardFromRow(page, component);

  await expect(members.getByRole('button', { name: 'Remove Alice' })).toHaveCount(0);
  await members.getByRole('button', { name: 'Remove bob' }).click();
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toBeVisible();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');
  await expect(state).toHaveAttribute('data-member-count', '2');

  await members.getByRole('button', { name: 'Cancel' }).click();
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toHaveCount(0);
  await expect(surface).toBeVisible();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');
  await expect(state).toHaveAttribute('data-member-count', '2');
});

test('confirming removes only the collaborator and keeps the card open', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'confirm' },
  });
  const { surface, members, state } = await enterCardFromRow(page, component);

  await members.getByRole('button', { name: 'Remove bob' }).click();
  await members.getByRole('button', { name: 'Confirm removing bob' }).click();

  await expect(state).toHaveAttribute('data-removing-principal-id', 'p-bob');
  await expect(surface).toBeVisible();
  await expect(members.getByRole('button', { name: 'Remove bob' })).toBeDisabled();
  await expect(members.locator('[data-workspace-hover-card-member-row]')).toHaveCount(2);
});

// Pointer parked far from the row and card so only focus drives the surface.
const OUTSIDE = { x: 880, y: 380 };

async function openCardFromKeyboard(page: Page, component: MountResult) {
  await page.mouse.move(OUTSIDE.x, OUTSIDE.y);
  const trigger = component.locator('[data-workspace-card-trigger]');
  await trigger.focus();
  const surface = page.locator('[data-workspace-card-hover-surface]');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-member-row]')).toHaveCount(2);
  return { trigger, surface, outside: component.locator('[data-share-hover-outside]') };
}

async function tabUntilFocused(page: Page, target: Locator) {
  for (let step = 0; step < 12; step++) {
    const focusedIs = await page.evaluate(() => ({
      surface:
        document
          .querySelector('[data-workspace-card-hover-surface]')
          ?.contains(document.activeElement) ?? false,
      row:
        document.querySelector('[data-workspace-card-row]')?.contains(document.activeElement) ??
        false,
    }));
    if (!focusedIs.surface && !focusedIs.row) break;
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

// Regression (fe#2440 reviewer, f5f4a22): Enter on Remove unmounts the focused
// button; the browser's focusout for a removed control carries a null
// relatedTarget and must not be read as leaving the card.
test('keyboard: Enter on Remove keeps the card open with the confirmation focused; Enter confirms', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'kbd-confirm' },
  });
  const { surface } = await openCardFromKeyboard(page, component);
  const state = component.locator('[data-share-hover-state]');

  await tabUntilFocused(page, surface.getByRole('button', { name: 'Remove bob' }));
  await page.keyboard.press('Enter');
  const confirm = surface.getByRole('button', { name: 'Confirm removing bob' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');

  await page.keyboard.press('Enter');
  await expect(state).toHaveAttribute('data-removing-principal-id', 'p-bob');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-workspace-card-hover-surface]')
            ?.contains(document.activeElement) ?? false,
      ),
    )
    .toBe(true);
});

test('keyboard: Cancel returns focus to Remove and a genuine blur still dismisses', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'kbd-cancel' },
  });
  const { trigger, surface } = await openCardFromKeyboard(page, component);
  const state = component.locator('[data-share-hover-state]');
  const remove = surface.getByRole('button', { name: 'Remove bob' });

  await tabUntilFocused(page, remove);
  await page.keyboard.press('Enter');
  await tabUntilFocused(page, surface.getByRole('button', { name: 'Cancel' }));
  await page.keyboard.press('Enter');
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(surface).toBeVisible();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');

  await trigger.focus();
  await expect(surface).toBeVisible();
  await trigger.blur();
  await expect(surface).toHaveCount(0);
});

// Regression (fe#2440 verifier, f5f4a22): focus that travelled row → card left
// the row's focus flag set, so after a focus-driven close the pointer could no
// longer reopen the card.
test('focus row → Remove → outside closes the card, and hovering the row reopens it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'focus-reenter' },
  });
  const { surface, outside } = await openCardFromKeyboard(page, component);
  const row = component.locator('[data-workspace-card-row]');

  await surface.getByRole('button', { name: 'Remove bob' }).focus();
  await expect(surface).toBeVisible();
  await outside.focus();
  await expect(surface).toHaveCount(0);

  await row.hover();
  await expect(surface).toBeVisible();
});

test('focus outside while the pointer rests in the card keeps it; leaving with the pointer then closes it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'mixed-exit' },
  });
  const { surface, outside } = await openCardFromKeyboard(page, component);

  await surface.getByRole('button', { name: 'Remove bob' }).focus();
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

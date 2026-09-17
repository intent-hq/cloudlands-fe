import { expect, test } from '@playwright/experimental-ct-svelte';
import ContextRowsPreview from '../context-rows.preview.svelte';

test('unread indicators remain inside clipped rows and disappear when notes are opened', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ContextRowsPreview);
  for (const id of ['context-plan', 'context-task', 'context-reference']) {
    const row = component.locator(`[data-note-id="${id}"]`);
    const indicator = row.locator('[title="Has unread changes"]');
    await expect(indicator).toBeVisible();
    const bounds = await indicator.evaluate((node) => {
      const badge = node.getBoundingClientRect();
      const list = node.closest('[data-slot="list-container"]')!.getBoundingClientRect();
      const row = node.closest('[data-note-id]')!.getBoundingClientRect();
      return {
        left: badge.left - list.left,
        top: badge.top - row.top,
        right: row.right - badge.right,
        bottom: row.bottom - badge.bottom,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeGreaterThanOrEqual(0);
    const button = row.locator('[data-slot="list-item"]');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(component.getByTestId('opened-note')).toHaveText(id);
    await expect(indicator).toHaveCount(0);
  }
});

test('expanding skills renders full-sized, unclipped glyphs for both scopes', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ContextRowsPreview);
  const skills = component.getByTestId('context-skills');
  await skills.getByRole('button', { name: /Skills/ }).click();
  for (const name of ['Interface craft', 'Project conventions']) {
    const button = skills.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const glyph = await button.locator('svg').boundingBox();
    expect(glyph).not.toBeNull();
    expect(glyph!.width).toBeCloseTo(14, 0);
    expect(glyph!.height).toBeCloseTo(14, 0);
    const buttonBox = (await button.boundingBox())!;
    expect(glyph!.x).toBeGreaterThanOrEqual(buttonBox.x);
    expect(glyph!.x + glyph!.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
  }
  await skills.getByRole('button', { name: /Skills/ }).focus();
  await page.keyboard.press('Enter');
  await expect(skills.getByRole('button', { name: 'Interface craft', exact: true })).toHaveCount(0);
});

import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import Harness from './TextEntryShortcutsHarness.svelte';

/** Focus Monaco's own text-entry target (an EditContext owner in Chromium). */
async function focusEditor(component: Locator): Promise<Locator> {
  const input = component.getByRole('textbox', { name: 'Editor content' });
  await expect(input).toBeVisible();
  // Guard the premise: Monaco types through an attached EditContext, not a textarea.
  expect(await input.evaluate((node) => 'editContext' in node && node.editContext != null)).toBe(
    true,
  );
  await input.focus();
  await expect(input).toBeFocused();
  return input;
}

async function focusPage(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('permission digit shortcuts still claim keys when no editor is focused', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { surface: 'permission' } });
  await expect(component.getByRole('button', { name: /Allow/ })).toBeVisible();
  await focusPage(page);
  await page.keyboard.press('1');
  await expect(component.getByTestId('claimed-keys')).toHaveText('1');
});

test('digits typed in a focused code editor reach the editor, not the pending permission', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { surface: 'permission' } });
  await expect(component.getByRole('button', { name: /Allow/ })).toBeVisible();
  await focusEditor(component);
  await page.keyboard.type('x12');
  await expect(component.getByTestId('editor-value')).toHaveText('x12');
  await expect(component.getByTestId('claimed-keys')).toHaveText('');
});

test('digit shortcuts still toggle question options when no editor is focused', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { surface: 'questions' } });
  const first = component.getByRole('checkbox', { name: /First/ });
  await expect(first).not.toBeChecked();
  await focusPage(page);
  await page.keyboard.press('1');
  await expect(first).toBeChecked();
});

test('digits typed in a focused code editor reach the editor, not the question options', async ({
  mount,
  page,
}) => {
  const component = await mount(Harness, { props: { surface: 'questions' } });
  const first = component.getByRole('checkbox', { name: /First/ });
  await focusEditor(component);
  await page.keyboard.type('x1');
  await expect(component.getByTestId('editor-value')).toHaveText('x1');
  await expect(first).not.toBeChecked();
});

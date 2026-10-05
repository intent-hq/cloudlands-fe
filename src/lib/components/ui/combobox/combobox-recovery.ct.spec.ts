import { test, expect } from '../../../../test/ct-test';
import Harness from './combobox-recovery.test-harness.svelte';

test('bound input focus and keyboard retry recover without losing the query', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await page.getByRole('button', { name: 'Focus people search' }).click();
  const input = page.getByRole('combobox', { name: 'People' });
  await expect(input).toBeFocused();
  await input.fill('Remote');
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await input.press('Tab');
  await expect(retry).toBeFocused();
  await retry.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Remote');
  await expect(page.getByRole('option', { name: 'Remote person' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByLabel('Selected person')).toHaveText('remote');
  await expect(page.getByLabel('Search attempts')).toHaveText('2');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('Tab leaves retry and Escape returns focus without trapping it', async ({ mount, page }) => {
  await mount(Harness);
  const input = page.getByRole('combobox', { name: 'People' });
  await input.fill('Remote');
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await input.press('Tab');
  await retry.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.press('Tab');
  await retry.press('Escape');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('Tab');
  await expect(page.getByRole('button', { name: 'Next action' })).toBeFocused();
});

test('compact popover owns initial and returned focus through search recovery', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { compact: true } });
  const trigger = page.getByRole('button', { name: 'Choose person' });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'People' });
  await expect(input).toBeFocused();
  await input.fill('Remote');
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await input.press('Tab');
  await expect(retry).toBeFocused();
  await retry.press('Enter');
  await expect(input).toBeFocused();
  await expect(page.getByRole('option', { name: 'Remote person' })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByLabel('Selected person')).toHaveText('remote');
  await expect(input).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('embedded picker closes on one Escape and restores trigger focus', async ({ mount, page }) => {
  await mount(Harness, { props: { compact: true } });
  const trigger = page.getByRole('button', { name: 'Choose person' });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'People' });
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('Escape');
  await expect(input).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

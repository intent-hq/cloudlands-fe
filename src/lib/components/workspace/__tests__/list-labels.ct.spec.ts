import { expect, test } from '../../../../test/ct-test';
import Preview from '../list-labels.preview.svelte';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('shell entries open scripts and terminals', async ({ mount }) => {
  const component = await mount(Preview);
  const shell = component.getByTestId('shell-labels');
  await shell.getByRole('button', { name: 'Running Development server', exact: true }).click();
  await expect(shell).toHaveAttribute('data-open-tab', 'Development server');
  await shell.getByRole('button', { name: 'Build shell', exact: true }).press('Enter');
  await expect(shell).toHaveAttribute('data-open-tab', 'Build shell');
});

test('list and collection selection updates accessibility state', async ({ mount }) => {
  const component = await mount(Preview);
  const list = component.getByTestId('shared-list-labels');
  await list.getByRole('button', { name: 'Beta', exact: true }).press('Enter');
  await expect(list.getByRole('button', { name: 'Beta', exact: true })).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(list.getByRole('button', { name: 'Alpha', exact: true })).not.toHaveAttribute(
    'data-selected',
  );
  const collection = component.getByRole('listbox', { name: 'Collection labels' });
  const alpha = collection.getByRole('option').filter({ hasText: 'Alpha' });
  await alpha.press('Space');
  await expect(alpha).toHaveAttribute('aria-selected', 'true');
});

test('navigation activation updates the current page', async ({ mount }) => {
  const component = await mount(Preview);
  const overview = component.getByRole('button', { name: 'Overview', exact: true });
  const settings = component.getByRole('button', { name: 'Settings', exact: true });
  await expect(overview).toHaveAttribute('aria-current', 'page');
  await settings.press('Enter');
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(overview).not.toHaveAttribute('aria-current');
});

test('menu actions and ordinary buttons activate', async ({ mount }) => {
  const component = await mount(Preview);
  const actions = component.getByTestId('action-labels');
  await actions.getByRole('button', { name: 'Inspect item' }).press('Enter');
  await expect(actions).toHaveAttribute('data-action', 'inspect');
  const ordinary = component.getByTestId('ordinary-button');
  await ordinary.press('Enter');
  await expect(component.getByRole('status', { name: 'Ordinary activation count' })).toHaveText(
    '1',
  );
});

import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import Preview from '../list-labels.preview.svelte';

async function expectNormal(label: Locator) {
  await expect(label).toHaveCSS('font-weight', '400');
  const effectiveWeight = await label.evaluate((element) => {
    const style = getComputedStyle(element);
    const axis = style.fontVariationSettings.match(/["']wght["']\s+([\d.]+)/);
    return Number(axis?.[1] ?? style.fontWeight);
  });
  expect(effectiveWeight).toBe(400);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('shell labels retain normal weight and size when opening scripts and terminals', async ({
  mount,
}) => {
  const component = await mount(Preview);
  const shell = component.getByTestId('shell-labels');
  for (const name of ['Development server', 'Run tests', 'Build shell']) {
    const label = shell.getByText(name, { exact: true });
    await expectNormal(label);
    await expect(label).toHaveCSS('font-size', '15px');
  }
  await shell.getByRole('button', { name: 'Running Development server', exact: true }).click();
  await expect(shell).toHaveAttribute('data-open-tab', 'Development server');
  await shell.getByRole('button', { name: 'Build shell', exact: true }).press('Enter');
  await expect(shell).toHaveAttribute('data-open-tab', 'Build shell');
  await expectNormal(shell.getByText('Build shell', { exact: true }));
});

test('list and collection selection never promotes a label to medium', async ({ mount }) => {
  const component = await mount(Preview);
  const list = component.getByTestId('shared-list-labels');
  for (const name of ['Alpha', 'Beta']) {
    await expectNormal(list.getByText(name, { exact: true }));
  }
  await list.getByRole('button', { name: 'Beta', exact: true }).press('Enter');
  await expect(list.getByRole('button', { name: 'Beta', exact: true })).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(list.getByRole('button', { name: 'Alpha', exact: true })).not.toHaveAttribute(
    'data-selected',
  );
  await expectNormal(list.getByText('Beta', { exact: true }));
  await expectNormal(list.getByText('Alpha', { exact: true }));
  const collection = component.getByRole('listbox', { name: 'Collection labels' });
  await expectNormal(collection.getByText('Beta', { exact: true }));
  const alpha = collection.getByRole('option').filter({ hasText: 'Alpha' });
  await alpha.press('Space');
  await expect(alpha).toHaveAttribute('aria-selected', 'true');
  await expectNormal(collection.getByText('Alpha', { exact: true }));
  await expectNormal(collection.getByText('Beta', { exact: true }));
});

test('navigation activation keeps normal variable-font weight', async ({ mount }) => {
  const component = await mount(Preview);
  const overview = component.getByRole('button', { name: 'Overview', exact: true });
  const settings = component.getByRole('button', { name: 'Settings', exact: true });
  const label = (button: Locator) => button.locator('span:not([aria-hidden])').last();
  await expect(overview).toHaveAttribute('aria-current', 'page');
  await expectNormal(label(overview));
  await expectNormal(label(settings));
  await settings.press('Enter');
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await expect(overview).not.toHaveAttribute('aria-current');
  await expectNormal(label(settings));
  await expectNormal(label(overview));
});

test('menu action selection retains normal text without changing ordinary button activation', async ({
  mount,
}) => {
  const component = await mount(Preview);
  const actions = component.getByTestId('action-labels');
  await expectNormal(actions.getByText('Inspect item', { exact: true }));
  await actions.getByRole('button', { name: 'Inspect item' }).press('Enter');
  await expect(actions).toHaveAttribute('data-action', 'inspect');
  await expectNormal(actions.getByText('Inspect item', { exact: true }));
  const ordinary = component.getByTestId('ordinary-button');
  await expect(ordinary).toHaveCSS('justify-content', 'center');
  await ordinary.press('Enter');
  await expect(component.getByRole('status', { name: 'Ordinary activation count' })).toHaveText(
    '1',
  );
});

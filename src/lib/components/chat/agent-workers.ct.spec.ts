import Preview from './agent-workers.preview.svelte';
import { test, expect } from '../../../test/ct-test';

test('a running background task can be stopped from the keyboard at narrow width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  const row = component.getByTestId('agent-worker-row').first();
  await expect(row.getByTestId('agent-worker-state')).toHaveText('Running');
  const disclosure = row.getByRole('button', { name: 'Start the dev server' }).first();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText(/^Type: /)).toBeVisible();
  const trigger = row.getByRole('button', { name: 'Actions for Start the dev server' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Stop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const bounds = await row.boundingBox();
  const control = await trigger.boundingBox();
  expect(control!.x + control!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
});

test('a long task title truncates instead of pushing Stop out of the card', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const component = await mount(Preview);
  const row = component.getByTestId('agent-worker-row').nth(1);
  const trigger = row.getByRole('button', { name: /^Actions for Watch the chat/ });
  await expect(trigger).toBeVisible();
  const card = await component.boundingBox();
  const control = await trigger.boundingBox();
  expect(control!.x + control!.width).toBeLessThanOrEqual(card!.x + card!.width);
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Stop' })).toBeVisible();
});

test('a lost connection shows the task as unknown without a Stop action', async ({ mount }) => {
  const component = await mount(Preview, { props: { unknown: true } });
  const row = component.getByTestId('agent-worker-row').first();
  await expect(row.getByTestId('agent-worker-state')).toHaveText('Connection lost');
  await expect(row.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
});

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
  const disclosure = row.getByRole('button', { name: 'npm run dev' }).first();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByTestId('agent-worker-command')).toHaveText('npm run dev');
  const trigger = row.getByRole('button', { name: 'Actions for npm run dev' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Stop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const bounds = await row.boundingBox();
  const control = await trigger.boundingBox();
  expect(control!.x + control!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
});

test('long commands wrap inside the card instead of widening it', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  const component = await mount(Preview);
  const row = component.getByTestId('agent-worker-row').nth(1);
  await row
    .getByRole('button', { name: /pnpm vitest/ })
    .first()
    .click();
  const command = row.getByTestId('agent-worker-command');
  await expect(command).toBeVisible();
  const card = await component.boundingBox();
  const box = await command.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width);
});

test('a lost connection shows the task as unknown without a Stop action', async ({ mount }) => {
  const component = await mount(Preview, { props: { unknown: true } });
  const row = component.getByTestId('agent-worker-row').first();
  await expect(row.getByTestId('agent-worker-state')).toHaveText('Connection lost');
  await expect(row.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
});

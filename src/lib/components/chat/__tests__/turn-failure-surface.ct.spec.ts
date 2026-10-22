import { expect, test } from '../../../../test/ct-test';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

test('historical failure details are keyboard accessible and preserve raw records', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await mount(TurnFailureNotice, {
    props: { reason: 'The agent stopped before it could finish the response.' },
  });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const disclosure = page.getByRole('button', { name: '1 recorded failure' });
  await disclosure.focus();
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText('The agent stopped before it could finish the response.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await disclosure.press('Enter');
  await expect(disclosure).toBeFocused();
  await expect(
    page.getByText('The agent stopped before it could finish the response.', { exact: true }),
  ).toHaveCount(0);
});

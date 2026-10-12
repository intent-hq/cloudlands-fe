import { expect, test } from '../../../../test/ct-test';
import Preview from '../failure-recovery.preview.svelte';

test('real transcript compacts failures once, preserves partial output, and clears current emphasis after recovery', async ({
  mount,
}) => {
  const component = await mount(Preview, { props: { state: 'failed', partial: true } });
  await expect(component.getByTestId('failure-recovery-card')).toHaveCount(1);
  expect(
    await component.evaluate((root) => {
      const history = root.querySelector('.turn-failure-notice')!;
      const current = root.querySelector('[data-testid="failure-recovery-card"]')!;
      return Boolean(history.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await expect(
    component.getByRole('button', { name: '2 recorded failures', exact: true }),
  ).toBeVisible();
  await expect(
    component.getByRole('button', { name: '1 recorded failure', exact: true }),
  ).toBeVisible();
  await expect(
    component.getByText(
      'I reviewed the changed files. The validation results still need checking.',
    ),
  ).toBeVisible();
  await component.getByRole('button', { name: '2 recorded failures', exact: true }).click();
  await expect(component.locator('[data-failure-message-id]')).toHaveCount(2);
  await component.update({ props: { state: 'attempting', partial: true } });
  await expect(component.getByTestId('failure-recovery-card')).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await component.update({ props: { state: 'recovered', partial: true } });
  await expect(
    component.getByText('The review is complete. The validation results are now checked.'),
  ).toBeVisible();
  await expect(
    component.getByRole('button', { name: '2 recorded failures', exact: true }),
  ).toBeVisible();
});

test('queued recovery retains terminal Retry and retired sessions remain read-only', async ({
  mount,
}, testInfo) => {
  const component = await mount(Preview, { props: { state: 'queued', width: 320 } });
  await expect(component.getByTestId('failure-recovery-card')).toHaveCount(1);
  await expect(component.getByTestId('queued-message-retry-status')).toHaveText('Queued');
  await expect(component.getByRole('button', { name: 'Send immediately' })).toBeVisible();
  const retry = component.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await retry.focus();
  await expect(retry).toBeFocused();
  await testInfo.attach('queued-terminal-retry', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await component.update({ props: { state: 'retired', width: 320 } });
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Send immediately' })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Details', exact: true })).toBeVisible();
});

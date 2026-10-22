import { test, expect } from '../../../../../test/ct-test';
import ManagerAgentAccess from '../manager-agent-access.preview.svelte';

test('Manager can use New Agent and choose workspace providers without host setup controls', async ({
  mount,
  page,
}) => {
  await mount(ManagerAgentAccess, { props: { initializeStore: true } });
  const fixture = page.getByTestId('manager-agent-access');
  await page.getByRole('button', { name: 'Create new agent', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-create-requests', '1');
  await page
    .getByRole('region', { name: 'Agent model' })
    .getByRole('button', { name: /Balanced/ })
    .click();
  await expect(page.getByRole('tab', { name: /Codex/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Claude/ })).toBeVisible();
  await expect(page.getByTestId('model-provider-settings-button')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /open settings|add profile|manage profiles|set.*default/i }),
  ).toHaveCount(0);
  await page.getByRole('tab', { name: /Claude/ }).click();
  await page.getByRole('option', { name: 'Fast Quick everyday tasks', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-model', 'claude-code-fast');
  await expect(fixture).toHaveAttribute('data-provider', 'claude-code');
  await expect(fixture).toHaveAttribute('data-model-pending', '1');
});

test('Participant cannot create agents or change the existing agent model after downgrade', async ({
  mount,
  page,
}) => {
  const component = await mount(ManagerAgentAccess, { props: { initializeStore: true } });
  const create = page.getByRole('button', { name: 'Create new agent', exact: true });
  await expect(create).toBeVisible();
  await component.update({ props: { role: 'collaborator' } });
  await expect(create).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Agent model' }).getByRole('button', { name: /Balanced/ }),
  ).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('named open state shows selectable models in a narrow dark viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await mount(ManagerAgentAccess, { props: { initializeStore: true, initialOpen: true } });
  await expect(
    page.getByRole('option', { name: 'Fast Quick everyday tasks', exact: true }),
  ).toBeVisible();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
});

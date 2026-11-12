import { expect, test } from '../../../../test/ct-test';
import ProposalStartOnPreview from './proposal-start-on.preview.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];

const machine = (page: Page) => page.getByRole('button', { name: /^Start on / });
const create = (page: Page) => page.getByRole('button', { name: /^Create workspace/ });
const applied = async (page: Page) =>
  JSON.parse((await page.getByTestId('applied-placement').textContent()) ?? 'undefined');

test('defaults to the backend when the proposer runs there', async ({ mount, page }) => {
  await mount(ProposalStartOnPreview, { props: { state: 'backend' } });
  await expect(machine(page)).toContainText('intent1');
  await expect(page.getByTestId('proposal-start-on-warning')).toHaveCount(0);
  await create(page).click();
  expect(await applied(page)).toBeNull();
});

test('defaults to the proposer machine and sends it on Apply', async ({ mount, page }) => {
  await mount(ProposalStartOnPreview, { props: { state: 'remote' } });
  await expect(machine(page)).toContainText('Mac mini');
  await create(page).click();
  expect(await applied(page)).toEqual({ target: 'remote', checkout: 'isolated', nodeId: 'd-mac' });
});

test('defaults to a new sandbox from the same E2B entry', async ({ mount, page }) => {
  await mount(ProposalStartOnPreview, { props: { state: 'e2b' } });
  await expect(machine(page)).toContainText('E2B · Team');
  await create(page).click();
  expect(await applied(page)).toEqual({
    target: 'e2b',
    checkout: 'isolated',
    cloudMachineId: 'e2b-team',
  });
});

test('an older backend falls back to where the proposer runs', async ({ mount, page }) => {
  await mount(ProposalStartOnPreview, { props: { state: 'legacy-remote' } });
  await expect(machine(page)).toContainText('Mac mini');
});

test('an unavailable default warns, blocks Apply, and another pick clears it', async ({
  mount,
  page,
}) => {
  await mount(ProposalStartOnPreview, { props: { state: 'unavailable' } });
  await expect(machine(page)).toContainText('Lab PC');
  await expect(page.getByTestId('proposal-start-on-warning')).toContainText('Lab PC');
  await expect(create(page)).toBeDisabled();

  await machine(page).click();
  const popup = page.getByRole('dialog', { name: 'Start on', exact: true });
  await popup.getByRole('option', { name: /^Mac mini/ }).click();
  await expect(machine(page)).toContainText('Mac mini');
  await expect(page.getByTestId('proposal-start-on-warning')).toHaveCount(0);
  await create(page).click();
  expect(await applied(page)).toEqual({ target: 'remote', checkout: 'isolated', nodeId: 'd-mac' });
});

test('a machine that was removed still shows, with a warning', async ({ mount, page }) => {
  await mount(ProposalStartOnPreview, { props: { state: 'removed' } });
  await expect(machine(page)).toContainText('Old box');
  await expect(page.getByTestId('proposal-start-on-warning')).toContainText('Old box');
  await expect(create(page)).toBeDisabled();
});

test('a first agent that fails after the workspace exists shows on the card', async ({
  mount,
  page,
}) => {
  await mount(ProposalStartOnPreview, { props: { state: 'launch-failed' } });
  await expect(page.getByTestId('proposal-launch-error')).toContainText('Mac mini went offline');
  await expect(page.getByTestId('proposal-open-created-workspace')).toBeVisible();
});

test('with no remote machine or E2B entry the field is hidden and Apply uses the backend', async ({
  mount,
  page,
}) => {
  await mount(ProposalStartOnPreview, { props: { state: 'hidden' } });
  await expect(create(page)).toBeEnabled();
  await expect(machine(page)).toHaveCount(0);
  await expect(page.getByTestId('proposal-start-on-gone')).toHaveCount(0);
  await create(page).click();
  expect(await applied(page)).toBeNull();
});

test('a gone machine with nothing else to choose hides the field and notes it', async ({
  mount,
  page,
}) => {
  await mount(ProposalStartOnPreview, { props: { state: 'gone-hidden' } });
  await expect(create(page)).toBeEnabled();
  await expect(machine(page)).toHaveCount(0);
  await expect(page.getByTestId('proposal-start-on-gone')).toContainText('Old box');
  await create(page).click();
  expect(await applied(page)).toBeNull();
});

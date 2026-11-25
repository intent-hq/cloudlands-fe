import { expect, test } from '../../../test/ct-test';
import ProviderSwitchHarness from './__tests__/ProviderSwitchHarness.svelte';
import type { ProviderSwitchDialogRow } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-types';

const codex = {
  providerId: 'codex',
  label: 'OpenAI Codex',
  models: [
    { value: 'sol', label: 'Sol 6.2' },
    { value: 'luna', label: 'Luna' },
  ],
};

const rows: ProviderSwitchDialogRow[] = [
  {
    key: 'claude-code|opus',
    providerRef: 'claude-code',
    model: 'opus',
    label: 'Claude Code · Opus 5.5',
    agents: [
      {
        agentId: 'a1',
        name: 'Implementor',
        workspaceName: 'Fix login',
        eligibleProviderIds: ['codex'],
      },
      {
        agentId: 'a2',
        name: 'Verifier',
        workspaceName: 'Dark mode',
        eligibleProviderIds: ['codex'],
      },
      { agentId: 'a3', name: 'Remote', workspaceName: 'Cluster', eligibleProviderIds: [] },
    ],
    workerCount: 2,
    targets: [codex],
    selection: { providerId: 'codex', modelId: 'sol' },
  },
  {
    key: 'claude-code|fable',
    providerRef: 'claude-code',
    model: 'fable',
    label: 'Claude Code · Fable 5.2',
    agents: [
      { agentId: 'a4', name: 'Planner', workspaceName: 'Billing', eligibleProviderIds: ['codex'] },
    ],
    workerCount: 0,
    targets: [codex],
    selection: { providerId: 'codex', modelId: 'sol' },
  },
];

test('group toast opens Switch all with one row per failed pair, and confirms the chosen targets', async ({
  mount,
  page,
}) => {
  const confirmed: unknown[] = [];
  await mount(ProviderSwitchHarness, {
    props: {
      rows,
      finishedRows: rows.map((row, index) => ({
        ...row,
        workersSwitched: index === 0 ? 2 : 0,
        agents: row.agents.map((agent) => ({
          ...agent,
          outcome:
            agent.agentId === 'a3'
              ? { status: 'unavailable' as const }
              : agent.agentId === 'a4'
                ? { status: 'failed' as const, reason: 'model rejected' }
                : { status: 'switched' as const },
        })),
      })),
      onConfirm: (selections) => confirmed.push(selections),
      onRetryAll: () => {},
    },
  });

  const toast = page.getByTestId('group-toast');
  await expect(toast.getByText('Claude Code usage or rate limit reached — 5 agents')).toBeVisible();
  await expect(toast.getByText('+2 more')).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Retry all' })).toBeVisible();
  await toast.getByRole('button', { name: 'Switch all…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Switch Claude Code agents')).toBeVisible();
  const dialogRows = dialog.getByTestId('provider-switch-row');
  await expect(dialogRows).toHaveCount(2);
  await expect(dialogRows.nth(0).getByText('3 agents, +2 workers')).toBeVisible();
  await expect(dialogRows.nth(1).getByText('1 agent')).toBeVisible();
  // Rows show counts only: no agent or workspace names.
  await expect(dialog.getByText('Implementor')).toHaveCount(0);
  await expect(dialog.getByText('Fix login')).toHaveCount(0);
  await expect(
    dialogRows.nth(0).getByText("1 agent can't use this target and stays as it is"),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/provider-switch/dialog-prefilled.png' });

  // The composer's model picker, limited to the row's eligible targets.
  const fablePicker = dialogRows.nth(1).getByTestId('provider-switch-picker');
  await fablePicker.getByRole('button', { name: /Sol 6\.2/ }).click();
  await expect(page.getByRole('option', { name: 'Opus 5.5', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Luna', exact: true }).click();
  await expect(fablePicker.getByRole('button', { name: /Luna/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Switch and retry' }).click();

  expect(confirmed).toEqual([
    {
      'claude-code|opus': { providerId: 'codex', modelId: 'sol' },
      'claude-code|fable': { providerId: 'codex', modelId: 'luna' },
    },
  ]);
  await expect(dialog.getByText('+2 workers switched, not restarted')).toBeVisible();
  const opusSummary = dialogRows.nth(0).getByTestId('provider-switch-summary');
  await expect(opusSummary.getByText('2 switched')).toBeVisible();
  await expect(opusSummary.getByText('1 not available')).toBeVisible();
  await expect(
    dialogRows.nth(1).getByTestId('provider-switch-summary').getByText('1 failed'),
  ).toBeVisible();
  await expect(dialogRows.nth(1).getByTestId('provider-switch-reason')).toHaveText(
    'model rejected',
  );
  await page.screenshot({ path: 'test-results/provider-switch/dialog-results.png' });
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('with no usable provider the dialog explains it and offers only Retry all', async ({
  mount,
  page,
}) => {
  let retried = 0;
  await mount(ProviderSwitchHarness, {
    props: {
      rows: rows.map((row) => ({ ...row, targets: [], selection: null })),
      onConfirm: () => {},
      onRetryAll: () => (retried += 1),
    },
  });
  await page.getByRole('button', { name: 'Switch all…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/No other provider is enabled and signed in/)).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Switch and retry' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Retry all' }).click();
  expect(retried).toBe(1);
  await page.screenshot({ path: 'test-results/provider-switch/dialog-no-targets.png' });
});

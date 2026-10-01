import { expect, test } from '../../../test/ct-test';
import ScriptHistoryView from './ScriptHistoryView.svelte';
import { makeScriptHistoryFixture } from './script-history-fixture';

test('reviews 984 inactive commands with bounded rendering in a 1,003-entry workspace', async ({
  mount,
}) => {
  const submitted: { ids: string[]; operation: string }[] = [];
  const component = await mount(ScriptHistoryView, {
    props: {
      scripts: makeScriptHistoryFixture(),
      onRetry: () => {},
      onInspect: () => {},
      onSubmit: (ids: string[], operation: string) => submitted.push({ ids, operation }),
    },
  });
  await component.getByRole('button', { name: 'Inactive commands', exact: true }).click();
  await expect(component.getByRole('checkbox')).toHaveCount(50);
  await component
    .getByRole('button', { name: 'Select matching commands (up to 1,000)', exact: true })
    .click();
  await component.getByRole('button', { name: 'Review selection (984)', exact: true }).click();
  expect(submitted).toEqual([]);
  await component.getByRole('button', { name: 'Archive selected', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].ids).toHaveLength(984);
  expect(submitted[0].operation).toBe('archive');
  await component.getByRole('textbox').fill('0983');
  await expect(component.getByRole('checkbox')).toHaveCount(1);
  await expect(component.getByText('Validation 0983', { exact: true })).toBeVisible();
});

test('removes newly live commands from a reviewed selection and keeps other clients archives out', async ({
  mount,
}) => {
  let scripts = makeScriptHistoryFixture().slice(0, 3);
  const submit = { ids: [] as string[] };
  const props = {
    scripts,
    onRetry: () => {},
    onInspect: () => {},
    onSubmit: (ids: string[]) => (submit.ids = ids),
  };
  const component = await mount(ScriptHistoryView, { props });
  await component.getByRole('button', { name: 'Inactive commands', exact: true }).click();
  await component
    .getByRole('button', { name: 'Select matching commands (up to 1,000)', exact: true })
    .click();
  await component.getByRole('button', { name: 'Review selection (3)', exact: true }).click();
  scripts = scripts.map((s, i) =>
    i === 0
      ? { ...s, runtime: { status: 'running', restartCount: 0 } }
      : i === 1
        ? { ...s, archivedAt: '2026-09-30T00:00:00Z' }
        : s,
  );
  await component.update({ props: { ...props, scripts } });
  await expect(component.getByText('Review selection (1)', { exact: true })).toBeVisible();
  await component.getByRole('button', { name: 'Archive selected', exact: true }).click();
  await expect.poll(() => submit.ids).toEqual(['synthetic-2']);
});

test('finds interrupted runs, inspects output and restores without starting', async ({ mount }) => {
  const events: string[] = [];
  const script = {
    ...makeScriptHistoryFixture()[0],
    archivedAt: '2026-09-30T00:00:00Z',
    lastRun: {
      outcome: 'interrupted' as const,
      stoppedAt: '2026-09-30T00:00:00Z',
      error: 'Daemon stopped during this command',
    },
  };
  const component = await mount(ScriptHistoryView, {
    props: {
      scripts: [script],
      onRetry: () => {},
      onInspect: (id: string) => events.push(`inspect:${id}`),
      onSubmit: (ids: string[], operation: string) => events.push(`${operation}:${ids.join(',')}`),
    },
  });
  await component.getByRole('textbox').fill('interrupted daemon');
  await expect(component.getByText('Interrupted', { exact: true })).toBeVisible();
  await expect(component.getByText('Daemon stopped during this command')).toBeVisible();
  await component.getByRole('button', { name: 'View output', exact: true }).click();
  await component.getByRole('checkbox').check();
  await component.getByRole('button', { name: 'Review selection (1)', exact: true }).click();
  await component.getByRole('button', { name: 'Restore selected', exact: true }).click();
  await expect.poll(() => events).toEqual(['inspect:synthetic-0', 'restore:synthetic-0']);
});

test('distinguishes empty, loading and failure; offers retry and reports partial results', async ({
  mount,
}) => {
  let retries = 0;
  const props = { scripts: [], onRetry: () => retries++, onSubmit: () => {}, onInspect: () => {} };
  const component = await mount(ScriptHistoryView, { props });
  await expect(component.getByText('No commands in this view.')).toBeVisible();
  await component.update({ props: { ...props, loading: true } });
  await expect(component.getByText('No commands in this view.')).toHaveCount(0);
  await component.update({ props: { ...props, loading: false, error: 'offline' } });
  await expect(component.getByText('Could not load script history. Try again.')).toBeVisible();
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => retries).toBe(1);
  await component.update({
    props: {
      ...props,
      loading: false,
      error: undefined,
      operation: { pending: false, changed: 2, skipped: 1 },
    },
  });
  await expect(component.getByRole('status')).toContainText('Updated 2; skipped 1');
});

test('keeps a failed archive selection available for reviewed retry', async ({ mount }) => {
  const props = {
    scripts: makeScriptHistoryFixture().slice(0, 1),
    onRetry: () => {},
    onSubmit: () => {},
    onInspect: () => {},
  };
  const component = await mount(ScriptHistoryView, { props });
  await component.getByRole('button', { name: 'Inactive commands', exact: true }).click();
  await component.getByRole('checkbox').check();
  await component.getByRole('button', { name: 'Review selection (1)', exact: true }).click();
  await component.getByRole('button', { name: 'Archive selected', exact: true }).click();
  await component.update({
    props: {
      ...props,
      operation: {
        pending: false,
        error: 'Synthetic storage failure; some changes may have committed',
      },
    },
  });
  await expect(component.getByRole('alert')).toContainText('Synthetic storage failure');
  await expect(component.getByRole('checkbox')).toBeChecked();
  await component.getByRole('button', { name: 'Review selection (1)', exact: true }).click();
  await expect(
    component.getByRole('button', { name: 'Archive selected', exact: true }),
  ).toBeEnabled();
});

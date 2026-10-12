import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { initAppStore, store } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { warmImport } from '../../../test/warm-import';
import {
  installSummaryFixture,
  summaryContext,
  type SelectionFixtureOptions,
} from '../components/repository-context-summary.preview-fixtures';

warmImport(() => import('../components/PrRepositorySelect.svelte'));
let disposeStore: () => void;
let fixture: ReturnType<typeof installSummaryFixture>;
beforeEach(() => {
  disposeStore = initAppStore(store).dispose;
});
afterEach(() => {
  cleanup();
  fixture?.dispose();
  disposeStore();
  vi.restoreAllMocks();
});

async function mount(options: SelectionFixtureOptions = {}) {
  fixture = installSummaryFixture('mixed-providers', false, { role: 'owner', ...options });
  const context = summaryContext('mixed-providers').roots[0];
  const onsaved = vi.fn();
  const invoke = vi.spyOn(window.electronAPI, 'invoke');
  const mounted = render((await import('../components/PrRepositorySelect.svelte')).default, {
    props: { context, onsaved },
  });
  return { ...mounted, context, onsaved, invoke };
}

async function chooseGithub() {
  const control = await screen.findByRole('combobox', { name: 'PR repository' });
  await fireEvent.click(control);
  await screen.findByRole('option', { name: /github · GitHub/ });
  await fireEvent.keyDown(control, { key: 'End' });
  await fireEvent.keyDown(control, { key: 'Enter' });
}

it('captures and saves the selected remote immediately and handles the original wire receipt', async () => {
  const { context, onsaved, invoke } = await mount();
  await chooseGithub();
  await waitFor(() => expect(onsaved).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION.CAPTURE, {
    root: context.root,
  });
  expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION.CONFIRM, {
    id: 'preview-selection-1',
    root: context.root,
    command: { kind: 'save', choice: { mode: 'explicit-remote', remoteName: 'github' } },
  });
  expect(fixture.selectionRequests).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('waits for capture, prevents a second selection while saving, and recovers after failure', async () => {
  const { onsaved } = await mount({ delayCapture: true, delayCommand: true });
  await chooseGithub();
  await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(1));
  expect(fixture.selectionRequests).toHaveLength(0);
  await waitFor(() =>
    expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true),
  );
  fixture.selectionCaptures[0].finish();
  await waitFor(() => expect(fixture.selectionRequests).toHaveLength(1));
  fixture.selectionRequests[0].finish({
    current: true,
    uncertain: false,
    attempt: {
      status: 'settled',
      receipt: {
        result: { kind: 'failed', code: 'storage-failed' },
        persistence: { kind: 'noEffect' },
      },
    },
  });
  await waitFor(() =>
    expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(onsaved).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true');
  await chooseGithub();
  await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(2));
  fixture.selectionCaptures[1].finish();
  await waitFor(() => expect(fixture.selectionRequests).toHaveLength(2));
  fixture.selectionRequests[1].finish();
  await waitFor(() => expect(onsaved).toHaveBeenCalledOnce());
});

it('does not send a pending choice after its root changes', async () => {
  const { rerender, onsaved } = await mount({ delayCapture: true });
  await chooseGithub();
  await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(1));
  await rerender({ context: summaryContext('mixed-providers').roots[1], onsaved });
  fixture.selectionCaptures[0].finish();
  await waitFor(() => expect(fixture.selectionReleases).toContain('preview-selection-1'));
  expect(fixture.selectionRequests).toHaveLength(0);
  expect(onsaved).not.toHaveBeenCalled();
});

it('does not send a pending choice after the connection changes', async () => {
  await mount({ delayCapture: true });
  await chooseGithub();
  await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(1));
  fixture.admit('replacement-host');
  fixture.selectionCaptures[0].finish();
  await waitFor(() => expect(fixture.selectionReleases).toContain('preview-selection-1'));
  expect(fixture.selectionRequests).toHaveLength(0);
});

it('hides the picker when management access is absent', async () => {
  await mount({ role: 'collaborator' });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(fixture.selectionCaptures).toHaveLength(0);
});

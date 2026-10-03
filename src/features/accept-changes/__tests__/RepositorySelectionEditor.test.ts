import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup, within } from '@testing-library/svelte';
import { initAppStore, store } from '$store/renderer/store';
import { warmImport } from '../../../test/warm-import';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectRepositorySelectionForEdit } from '$store/renderer/slices/repository-context/repository-context-selectors';
import {
  repositorySelectionEditRequested,
  repositorySelectionEditEnded,
  repositorySelectionConfirmRequested,
  repositorySelectionReconcileRequested,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { resetConfirmServiceForTests } from '$lib/components/patterns/confirm/confirm-service';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';
import type { SelectionObservation, SelectionPreview } from '$shared/types/repository-selection';
import {
  installSummaryFixture,
  previewWorkspaceId,
  summaryContext,
  type SelectionFixtureOptions,
} from '../components/repository-context-summary.preview-fixtures';

warmImport(() => import('../components/RepositorySelectionEditor.svelte'));
warmImport(() => import('$lib/components/patterns/confirm/ConfirmHost.svelte'));
const primary: RepositoryRootIdentity = { workspaceId: previewWorkspaceId, kind: 'primary' };
const toolsRoot: RepositoryRootIdentity = { ...primary, kind: 'registered', gitRootId: 'tools' };
type Receipt = Extract<
  NonNullable<SelectionObservation['attempt']>,
  { status: 'settled' }
>['receipt'];
const snapshot = (root = primary): SelectionPreview['snapshot'] => ({
  root,
  rootIncarnation: '1',
  selectionRevision: '1',
  selection: { kind: 'reset' },
});
const observed = (
  result: Receipt['result'],
  persistence: Receipt['persistence'],
  current = true,
): SelectionObservation => ({
  current,
  uncertain: false,
  attempt: { status: 'settled', receipt: { result, persistence } },
});
let fixture: ReturnType<typeof installSummaryFixture>;
let disposeStore: () => void;
beforeEach(() => {
  disposeStore = initAppStore(store).dispose;
  resetConfirmServiceForTests();
});
afterEach(() => {
  cleanup();
  resetConfirmServiceForTests();
  fixture?.dispose();
  disposeStore();
  vi.restoreAllMocks();
});
async function mount(options: SelectionFixtureOptions = {}, root = primary) {
  fixture = installSummaryFixture('self-managed', false, { role: 'owner', ...options });
  render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
  return render((await import('../components/RepositorySelectionEditor.svelte')).default, {
    root,
    label: 'Tools repository',
  });
}
async function edit() {
  await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
  await screen.findByRole('combobox', { name: 'Review choice' });
}
async function named(value: string) {
  const control = screen.getByRole('combobox', { name: 'Review choice' });
  await fireEvent.click(control);
  await screen.findByRole('option', { name: 'Named remote' });
  await fireEvent.keyDown(control, { key: 'End' });
  await fireEvent.keyDown(control, { key: 'Enter' });
  await fireEvent.input(await screen.findByRole('textbox', { name: 'Exact remote name' }), {
    target: { value },
  });
}

async function confirmSave(reset = false) {
  await fireEvent.click(
    screen.getByRole('button', { name: reset ? 'Reset choice' : 'Save choice' }),
  );
  await fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
}
const commands = () => fixture.selectionRequests.filter((r) => r.kind === 'confirm');

describe('visible selection through real Store, saga, live client and controlled IPC', () => {
  it.each([primary, toolsRoot])(
    'captures only on Edit with the exact root %j and ends its original descriptor',
    async (root) => {
      const dispatch = vi.spyOn(store, 'dispatch');
      await mount({}, root);
      expect(fixture.selectionCaptures).toHaveLength(0);
      await edit();
      expect(fixture.selectionCaptures.map((c) => c.root)).toEqual([root]);
      expect(commands()).toHaveLength(0);
      const action = dispatch.mock.calls
        .map(([a]) => a)
        .find((a) => a.type === repositorySelectionEditRequested.type)!;
      await fireEvent.click(screen.getByRole('button', { name: 'Close edit' }));
      await waitFor(() => expect(fixture.selectionReleases).toEqual(['preview-selection-1']));
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Edit review repository' }),
      );
      expect(
        dispatch.mock.calls.some(
          ([a]) =>
            a.type === repositorySelectionEditEnded.type &&
            JSON.stringify(a.payload) === JSON.stringify(action.payload),
        ),
      ).toBe(true);
      expect(fixture.captures).toHaveLength(0);
    },
  );

  it.each(['owner', 'member', 'guest-owner', 'collaborator', 'stale-guest'] as const)(
    'uses the existing %s management affordance',
    async (role) => {
      await mount({ role });
      const allowed = role === 'owner' || role === 'member';
      expect(!!screen.queryByRole('button', { name: 'Edit review repository' })).toBe(allowed);
      if (allowed) {
        await edit();
        expect(fixture.selectionCaptures).toHaveLength(1);
      } else expect(fixture.selectionCaptures).toHaveLength(0);
    },
  );

  it.each([
    [{ kind: 'neverSaved' }, 'No review choice has been saved.'],
    [{ kind: 'reset' }, 'The review choice was reset.'],
    [{ kind: 'saved', value: { mode: 'automatic' } }, 'Saved choice: Automatic.'],
    [
      { kind: 'saved', value: { mode: 'explicit-remote', remoteName: 'review-origin' } },
      'Saved choice: review-origin.',
    ],
    [
      { kind: 'saved', value: { mode: 'unresolved-historical', recordId: 'private-history' } },
      'A historical choice is saved.',
    ],
    [
      { kind: 'saved', value: summaryContext('migrated').roots[0].reviewSelection.saved },
      'Migrated',
    ],
  ] as Array<[SelectionPreview['snapshot']['selection'], string]>)(
    'shows captured saved intent %j without coercing historical choices',
    async (saved, text) => {
      await mount({ saved });
      await edit();
      expect(
        screen.getByText(
          (_, node) =>
            node?.getAttribute('data-selection-saved') !== null &&
            !!node?.textContent?.includes(text),
        ),
      ).toBeTruthy();
      expect(document.body.textContent).not.toMatch(
        /private-history|private-evidence|private-record/,
      );
      if (
        saved.kind === 'saved' &&
        ['migrated-canonical', 'unresolved-historical'].includes(saved.value.mode)
      ) {
        await fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(commands()).toHaveLength(0);
      }
    },
  );

  it('freezes an exact named command, keeps the draft on cancel, and submits once despite duplicate clicks', async () => {
    await mount();
    await edit();
    await named('upstream/review');
    await fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    expect(commands()).toHaveLength(0);
    expect(await screen.findByText('upstream/review for Tools repository.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('upstream/review');
    await fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    const yes = await screen.findByRole('button', { name: 'Confirm' });
    await fireEvent.click(yes);
    await fireEvent.click(yes);
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0]).toMatchObject({
      root: primary,
      command: { kind: 'save', choice: { mode: 'explicit-remote', remoteName: 'upstream/review' } },
    });
    await screen.findByText('The choice was applied.');
    expect(screen.queryByText('Waiting for the operation result…')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('upstream/review');
  });

  it.each([false, true])('keeps saving Automatic distinct from Reset (%s)', async (reset) => {
    await mount();
    await edit();
    await confirmSave(reset);
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0].command).toEqual(
      reset ? { kind: 'reset' } : { kind: 'save', choice: { mode: 'automatic' } },
    );
  });

  it.each(['', ' origin', 'origin ', '　origin', 'a'.repeat(1025), '\uD800'])(
    'rejects invalid exact names without normalizing %j',
    async (value) => {
      await mount();
      await edit();
      await named(value);
      await fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(commands()).toHaveLength(0);
      expect(screen.getByText(/Choose Automatic or enter a valid remote name/)).toBeTruthy();
    },
  );

  it.each(['root', 'host', 'role', 'close'] as const)(
    'does not submit a confirmation after %s changes',
    async (change) => {
      const rendered = await mount();
      await edit();
      await named('keep-draft');
      await fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
      const yes = await screen.findByRole('button', { name: 'Confirm' });
      if (change === 'root')
        await rendered.rerender({ root: toolsRoot, label: 'Different repository' });
      if (change === 'host') fixture.admit('local-B');
      if (change === 'role') fixture.grant('collaborator');
      if (change === 'close') rendered.unmount();
      await fireEvent.click(yes);
      expect(commands()).toHaveLength(0);
      expect(fixture.selectionCaptures).toHaveLength(1);
    },
  );

  it('releases a delayed capture on unmount without confirming or recapturing', async () => {
    const rendered = await mount({ delayCapture: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(1));
    rendered.unmount();
    fixture.selectionCaptures[0].finish();
    await waitFor(() => expect(fixture.selectionReleases).toEqual(['preview-selection-1']));
    expect(fixture.selectionRequests).toHaveLength(0);
  });

  it('ends on workspace unmount, and a new explicit edit gets a different descriptor', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount();
    await edit();
    store.dispatch(workspaceUnmounted(previewWorkspaceId));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Review repository choice' })).toBeNull(),
    );
    await edit();
    const actions = dispatch.mock.calls
      .map(([a]) => a)
      .filter((a) => a.type === repositorySelectionEditRequested.type);
    expect(actions).toHaveLength(2);
    expect(actions[1].payload).not.toEqual(actions[0].payload);
    expect(fixture.selectionCaptures).toHaveLength(2);
  });

  it('retains the original failed+committed result after retirement, then clears public access on Labs visibility loss', async () => {
    const result = observed(
      { kind: 'failed', code: 'admission-retired' },
      { kind: 'committed', selectionRevision: '2' },
    );
    await mount({ role: 'member', delayCommand: true });
    await edit();
    await named('draft');
    await confirmSave();
    await waitFor(() => expect(commands()).toHaveLength(1));
    fixture.retireSelection();
    commands()[0].finish(result);
    await screen.findByText('The operation failed.');
    expect(screen.getByText('The change was committed to storage.')).toBeTruthy();
    expect(
      screen.getByText('This is an earlier edit, not the current repository state.'),
    ).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('draft');
    expect(
      (screen.getByRole('button', { name: 'Save choice' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(fixture.selectionRequests).toHaveLength(2));
    expect(fixture.selectionRequests[1]).toMatchObject({
      kind: 'reconcile',
      id: commands()[0].id,
      root: primary,
    });
    expect(commands()).toHaveLength(1);
    store.dispatch(setLabsMultiplayerEnabled(false));
    await waitFor(() => expect(screen.queryByText('The operation failed.')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Start a new edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check result' })).toBeNull();
    expect(commands()).toHaveLength(1);
  });

  it('closed public view stays null when an identical descriptor is dispatched again', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount();
    await edit();
    await confirmSave();
    await screen.findByText('The choice was applied.');
    const action = dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a.type === repositorySelectionEditRequested.type)! as ReturnType<
      typeof repositorySelectionEditRequested
    >;
    fixture.retireSelection('closed');
    await waitFor(() => expect(screen.queryByText('The choice was applied.')).toBeNull());
    store.dispatch(action);
    expect(selectRepositorySelectionForEdit.select(store.state, action.payload[0])).toBeNull();
    expect(fixture.selectionCaptures).toHaveLength(1);
    expect(fixture.selectionReleases).toHaveLength(0);
    expect(commands()).toHaveLength(1);
  });

  it.each([
    [
      observed({ kind: 'unchanged', snapshot: snapshot() }, { kind: 'noEffect' }),
      'The choice was already the same.',
      'No storage change was made.',
    ],
    [
      observed({ kind: 'conflict', snapshot: snapshot() }, { kind: 'noEffect' }),
      'The choice changed elsewhere.',
      'No storage change was made.',
    ],
    [
      observed({ kind: 'missingRoot' }, { kind: 'notAttempted' }),
      'The original repository is no longer available.',
      'Storage was not attempted.',
    ],
    [
      observed({ kind: 'failed', code: 'storage-failed' }, { kind: 'unknown' }),
      'The operation failed.',
      'The storage outcome is unknown.',
    ],
    [
      { current: true, uncertain: false, attempt: { status: 'notStarted' } },
      'No operation has started.',
      null,
    ],
    [
      { current: true, uncertain: false, attempt: { status: 'pending' } },
      'Waiting for the operation result…',
      null,
    ],
  ] as Array<[SelectionObservation, string, string | null]>)(
    'renders independent result and persistence %j',
    async (result, label, persistence) => {
      await mount({ result });
      await edit();
      await named('retained-draft');
      await confirmSave();
      expect(await screen.findByText((t) => t.startsWith(label))).toBeTruthy();
      if (persistence) expect(screen.getByText(persistence)).toBeTruthy();
      expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('retained-draft');
      expect(commands()).toHaveLength(1);
      expect(fixture.selectionCaptures).toHaveLength(1);
    },
  );

  it('lost reply offers explicit original reconciliation only, separate from unknown persistence', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount({ delayCommand: true });
    await edit();
    await confirmSave();
    await waitFor(() => expect(commands()).toHaveLength(1));
    commands()[0].lose();
    await screen.findByText(/The result was not observed/);
    expect(screen.queryByText('The storage outcome is unknown.')).toBeNull();
    const first = dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a.type === repositorySelectionConfirmRequested.type)! as ReturnType<
      typeof repositorySelectionConfirmRequested
    >;
    await fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(fixture.selectionRequests).toHaveLength(2));
    const check = dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a.type === repositorySelectionReconcileRequested.type)! as ReturnType<
      typeof repositorySelectionReconcileRequested
    >;
    expect(check.payload?.[0]).toEqual(first.payload?.[0]);
    fixture.selectionRequests[1].finish(
      observed({ kind: 'failed', code: 'completion-unobserved' }, { kind: 'unknown' }),
    );
    await screen.findByText('The storage outcome is unknown.');
    expect(screen.queryByText(/The result was not observed/)).toBeNull();
    expect(commands()).toHaveLength(1);
    expect(fixture.selectionCaptures).toHaveLength(1);
  });

  it('server capture refusal stays unavailable without a fallback operation', async () => {
    await mount({ refuseCapture: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await screen.findByText(/This edit is unavailable/);
    expect(screen.queryByRole('button', { name: 'Save choice' })).toBeNull();
    expect(fixture.selectionRequests).toHaveLength(0);
  });

  it('keeps sibling root results and teardown isolated', async () => {
    const first = await mount({ delayCommand: true });
    await edit();
    const Component = (await import('../components/RepositorySelectionEditor.svelte')).default;
    const second = render(Component, { root: toolsRoot, label: 'Tools root' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    const forms = screen.getAllByRole('region', { name: 'Review repository choice' });
    await fireEvent.click(within(forms[1]).getByRole('button', { name: 'Reset choice' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0].root).toEqual(toolsRoot);
    commands()[0].finish();
    await screen.findByText('The choice was applied.');
    expect(within(forms[0]).queryByText('The choice was applied.')).toBeNull();
    first.unmount();
    await waitFor(() => expect(fixture.selectionReleases).toEqual(['preview-selection-1']));
    expect(screen.getByText('The choice was applied.')).toBeTruthy();
    second.unmount();
  });
  it('does not capture from a stale visible button after admission becomes null or auto-open when it returns', async () => {
    await mount();
    const start = screen.getByRole('button', { name: 'Edit review repository' });
    store.dispatch(principalContextChanged(null));
    await fireEvent.click(start);
    expect(fixture.selectionCaptures).toHaveLength(0);
    fixture.admit('host-A');
    await screen.findByRole('button', { name: 'Edit review repository' });
    expect(fixture.selectionCaptures).toHaveLength(0);
  });

  it('drops a late capture after a root switch and never adopts it into the new form', async () => {
    const rendered = await mount({ delayCapture: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await waitFor(() => expect(fixture.selectionCaptures).toHaveLength(1));
    await rendered.rerender({ root: toolsRoot, label: 'Other repository' });
    fixture.selectionCaptures[0].finish();
    await waitFor(() => expect(fixture.selectionReleases).toEqual(['preview-selection-1']));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fixture.selectionCaptures).toHaveLength(1);
    expect(fixture.selectionRequests).toHaveLength(0);
  });
});

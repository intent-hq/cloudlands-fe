import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/svelte';
import { initAppStore, store } from '$store/renderer/store';
import { warmImport } from '../../../test/warm-import';
import { resetConfirmServiceForTests } from '$lib/components/patterns/confirm/confirm-service';
import {
  nativeReviewEditRequested,
  nativeReviewConfirmRequested,
  nativeReviewEditEnded,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { selectNativeReviewForOwner } from '$store/renderer/slices/repository-context/repository-context-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { updateWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';
import {
  installNativeFixture,
  nativeRoot,
  nativeObservation,
  withPublication,
  type NativeFixtureOptions,
} from '../components/native-review-attempt.preview-fixtures';

warmImport(() => import('../components/NativeReviewAttempt.svelte'));
warmImport(() => import('$lib/components/workspace/PullRequestCreator.svelte'));
warmImport(() => import('$lib/components/patterns/confirm/ConfirmHost.svelte'));
let fixture: ReturnType<typeof installNativeFixture>;
let dispose: () => void;
beforeEach(() => {
  dispose = initAppStore(store).dispose;
  resetConfirmServiceForTests();
});
afterEach(() => {
  cleanup();
  resetConfirmServiceForTests();
  fixture?.dispose();
  dispose();
  vi.restoreAllMocks();
});
async function mount(
  options: NativeFixtureOptions = {},
  root = nativeRoot,
  standalone = false,
  onClose?: () => void,
) {
  fixture = installNativeFixture(options);
  render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
  if (standalone)
    return render((await import('$lib/components/workspace/PullRequestCreator.svelte')).default, {
      workspaceId: WorkspaceId(root.workspaceId),
      onClose,
    });
  return render((await import('../components/NativeReviewAttempt.svelte')).default, { root });
}
async function start() {
  await fireEvent.click(screen.getByRole('button', { name: 'Start a review' }));
  await screen.findByRole('button', { name: 'Prepare merge request' });
}
async function prepare() {
  await start();
  await fireEvent.click(screen.getByRole('button', { name: 'Prepare merge request' }));
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'Suggested request',
    ),
  );
}
async function submit(agree = true) {
  await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  const dialog = await screen.findByRole('dialog');
  await fireEvent.click(within(dialog).getByRole('button', { name: agree ? 'Create' : 'Cancel' }));
}
const executed = () => fixture.requests.filter((r) => r.kind === 'execute');

describe('native review through rendered Store, root saga, Live client and controlled IPC', () => {
  it('keeps the standalone Close action and ends the original attempt before dismissal', async () => {
    const onClose = vi.fn();
    await mount({}, nativeRoot, true, onClose);
    await prepare();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(fixture.releases[0].root).toEqual(nativeRoot);
    expect(executed()).toHaveLength(0);
  });

  it('shows an actual review alongside contradictory failure and completed stage facts', async () => {
    await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    const result = nativeObservation('created');
    result.execute!.success = false;
    result.execute!.error = 'Later original stage failed';
    result.execute!.steps = [
      {
        id: 'original-step',
        name: 'Original step',
        status: 'failed',
        error: 'Original step error',
      },
    ];
    executed()[0].finish(result);
    await screen.findByRole('link', { name: 'Actual remote review title' });
    expect(screen.getByText('Later original stage failed')).toBeTruthy();
    expect(screen.getByText('Original step error')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'Suggested request',
    );
    expect(executed()).toHaveLength(1);
  });
  it('preserves confirmed state, draft, timestamps and actual review branch facts', async () => {
    await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    const result = nativeObservation('reused');
    const outcome = result.execute!.reviewExecution!.outcome;
    if (outcome.status !== 'reused') throw new Error('Expected reused fixture');
    Object.assign(outcome.review, {
      state: 'merged',
      draft: true,
      headSha: null,
      sourceBranch: 'actual-source',
      targetBranch: 'actual-target',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
    });
    executed()[0].finish(result);
    const original = await screen.findByRole('region', { name: 'Original execution' });
    expect(within(original).getByText('Merged')).toBeTruthy();
    expect(within(original).getByText('Draft')).toBeTruthy();
    expect(within(original).getByText('actual-source')).toBeTruthy();
    expect(within(original).getByText('actual-target')).toBeTruthy();
    expect(original.textContent).toContain('2026');
    expect(within(original).getByText('Unknown')).toBeTruthy();
  });

  it.each<RepositoryRootIdentity>([
    nativeRoot,
    { ...nativeRoot, kind: 'registered', gitRootId: 'tools' },
  ])('prepares only after explicit start and retains the exact root %j', async (root) => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount({}, root);
    expect(fixture.base.captures).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
    await start();
    expect(fixture.base.captures).toHaveLength(1);
    expect(fixture.captures).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Prepare merge request' }));
    await screen.findByRole('textbox', { name: 'Title' });
    await waitFor(() => expect(fixture.captures).toHaveLength(1));
    expect(fixture.captures[0].input).toEqual({
      workspaceId: root.workspaceId,
      action: 'create-pr',
      review: { root, choice: { kind: 'saved' } },
    });
    const action = dispatch.mock.calls
      .map(([a]) => a)
      .find((a) => a.type === nativeReviewEditRequested.type)! as ReturnType<
      typeof nativeReviewEditRequested
    >;
    await fireEvent.click(screen.getByRole('button', { name: 'Close edit' }));
    await waitFor(() => expect(fixture.releases).toEqual([{ id: 'native-preview-1', root }]));
    expect(
      dispatch.mock.calls.some(
        ([a]) =>
          a.type === nativeReviewEditEnded.type &&
          (a as ReturnType<typeof nativeReviewEditEnded>).payload[0] === action.payload[0],
      ),
    ).toBe(true);
    expect(executed()).toHaveLength(0);
  });
  it('keeps fields on cancelled confirmation and claims one immutable create-only command', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount();
    await prepare();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'My title' },
    });
    await submit(false);
    expect(executed()).toHaveLength(0);
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'My title',
    );
    await submit();
    await screen.findByText('Existing merge request reused');
    expect(executed()).toHaveLength(1);
    expect(executed()[0].command).toEqual({ prTitle: 'My title', prBody: 'Suggested details' });
    const original = (
      dispatch.mock.calls
        .map(([a]) => a)
        .find((a) => a.type === nativeReviewEditRequested.type)! as ReturnType<
        typeof nativeReviewEditRequested
      >
    ).payload[0];
    store.dispatch(nativeReviewConfirmRequested(original, { prTitle: 'Changed claim' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(executed()).toHaveLength(1);
    expect(fixture.legacyRequests).toHaveLength(0);
  });
  it.each(['member', 'owner'] as const)(
    'renders actual metadata for %s without requiring disclosed connection identity',
    async (role) => {
      await mount({ role });
      await prepare();
      await submit();
      const result = await screen.findByRole('region', { name: 'Original execution' });
      expect(within(result).getByRole('link', { name: 'Actual remote review title' })).toBeTruthy();
      expect(result.textContent).toContain('local-B');
      expect(result.textContent).toContain('remote-A');
      expect(result.textContent).toContain('Local commits are ahead');
      expect(result.textContent).toContain('Unknown');
      expect(fixture.captures[0].preview.reviewPreparation.source.connection).toBeUndefined();
    },
  );
  it.each(['guest-owner', 'collaborator', 'stale-guest'] as const)(
    'does not prepare for %s even when repository facts are readable',
    async (role) => {
      await mount({ role });
      await start();
      expect(
        (screen.getByRole('button', { name: 'Prepare merge request' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(fixture.captures).toHaveLength(0);
    },
  );
  it.each([{ refusePrepare: true }, { invalidPrepare: true }])(
    'retains form fields when preparation refuses: %j',
    async (options) => {
      await mount(options);
      await start();
      await fireEvent.click(screen.getByRole('button', { name: 'Prepare merge request' }));
      const title = await screen.findByRole('textbox', { name: 'Title' });
      await fireEvent.input(title, { target: { value: 'Retained draft' } });
      expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect((title as HTMLInputElement).value).toBe('Retained draft');
      expect(executed()).toHaveLength(0);
    },
  );
  it.each(['created', 'reused', 'failed', 'uncertain', 'pending', 'not-attempted'] as const)(
    'keeps outcome/envelope facts and form contents for %s',
    async (scene) => {
      await mount({ scene });
      await prepare();
      await submit();
      await screen.findByRole('region', { name: 'Original execution' });
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
        'Suggested request',
      );
      expect(fixture.legacyRequests).toHaveLength(0);
      if (scene === 'failed')
        expect(screen.getByText('Completed commit: completed-B')).toBeTruthy();
      if (scene === 'created' || scene === 'reused')
        expect(screen.getByRole('link', { name: 'Actual remote review title' })).toBeTruthy();
      expect(executed()).toHaveLength(1);
    },
  );
  it.each([
    { state: 'unknown' as const, localHeadSha: null, remoteSourceSha: null },
    { state: 'remote-branch-missing' as const, localHeadSha: 'local-B' },
    { state: 'diverged' as const, localHeadSha: 'local-B', remoteSourceSha: 'remote-A' },
  ])('renders publication independently of a reused review: %j', async (publication) => {
    const view = await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    executed()[0].finish(withPublication(publication));
    await screen.findByText('Existing merge request reused');
    expect(
      view.container
        .querySelector('[data-native-publication]')
        ?.getAttribute('data-native-publication'),
    ).toBe(publication.state);
  });
  it('preserves original execution on uncertain/rejected Check result and separates reconciliation facts', async () => {
    await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    executed()[0].finish(nativeObservation('failed'));
    await screen.findByText('Completed commit: completed-B');
    await fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    fixture.requests[1].lose();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Check result' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.getByText('Completed commit: completed-B')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(fixture.requests).toHaveLength(3));
    const original = nativeObservation('failed');
    const checked = nativeObservation('reused').execute!;
    fixture.requests[2].finish({
      ...original,
      reconciliation: {
        operationId: checked.operationId,
        root: checked.root,
        state: 'settled',
        reviewExecution: checked.reviewExecution,
      },
    });
    await screen.findByRole('region', { name: 'Original result check' });
    expect(screen.getByText('Original execution failed')).toBeTruthy();
    expect(executed()).toHaveLength(1);
    expect(fixture.captures).toHaveLength(1);
  });
  it('reports a lost execute as uncertain and checks only its original attempt', async () => {
    await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    executed()[0].lose();
    await screen.findByText(/The result is uncertain/);
    await fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
    await waitFor(() => expect(fixture.requests).toHaveLength(2));
    expect(fixture.requests[1].id).toBe(fixture.requests[0].id);
    expect(fixture.captures).toHaveLength(1);
    expect(executed()).toHaveLength(1);
  });
  it.each(['root', 'host', 'admission', 'unmount'] as const)(
    'ends original delayed capture on %s without reacquiring',
    async (change) => {
      const component = await mount({ delayPrepare: true });
      await start();
      await fireEvent.click(screen.getByRole('button', { name: 'Prepare merge request' }));
      await waitFor(() => expect(fixture.captures).toHaveLength(1));
      if (change === 'root')
        await component.rerender({
          root: { ...nativeRoot, kind: 'registered', gitRootId: 'tools' },
        });
      if (change === 'host') fixture.base.admit('host-B');
      if (change === 'admission') store.dispatch(principalContextChanged(null));
      if (change === 'unmount') component.unmount();
      fixture.captures[0].finish();
      await waitFor(() => expect(fixture.releases).toHaveLength(1));
      expect(fixture.releases[0].root).toEqual(nativeRoot);
      expect(executed()).toHaveLength(0);
      expect(fixture.captures).toHaveLength(1);
    },
  );
  it('does not execute if ownership changes while confirmation is open', async () => {
    await mount();
    await prepare();
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const dialog = await screen.findByRole('dialog');
    fixture.base.admit('host-B');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(executed()).toHaveLength(0);
  });
  it('hides closed public presentation, keeps original occupancy and releases pending work', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount({ delayCommand: true });
    await prepare();
    await submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    const original = (
      dispatch.mock.calls
        .map(([a]) => a)
        .find((a) => a.type === nativeReviewEditRequested.type)! as ReturnType<
        typeof nativeReviewEditRequested
      >
    ).payload[0];
    store.dispatch(workspaceUnmounted(nativeRoot.workspaceId));
    executed()[0].finish(nativeObservation('created'));
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(selectNativeReviewForOwner.select(store.state, original)).toBeNull();
    store.dispatch(nativeReviewEditRequested(original, fixture.captures[0].input));
    expect(screen.queryByRole('link', { name: 'Actual remote review title' })).toBeNull();
    expect(fixture.captures).toHaveLength(1);
  });
  it('routes the actual standalone GitLab form through create only and never installs synthetic legacy PR metadata', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount({}, nativeRoot, true);
    await prepare();
    await submit();
    await screen.findByText('Existing merge request reused');
    expect(fixture.captures[0].input.action).toBe('create-pr');
    expect(fixture.captures[0].input.options).toBeUndefined();
    expect(fixture.legacyRequests).toHaveLength(0);
    expect(dispatch.mock.calls.some(([a]) => a.type === updateWorkspaceEntity.type)).toBe(false);
  });
  it('preserves the Labs-off legacy form without acquiring repository/native state', async () => {
    await mount({}, nativeRoot, true);
    store.dispatch(setLabsMultiplayerEnabled(false));
    await fireEvent.click(await screen.findByRole('button', { name: 'Auto-fill & Create' }));
    await screen.findByText('Controlled legacy failure');
    expect(fixture.legacyRequests.map((r) => r.method)).toEqual([
      'accept-changes.prepare',
      'accept-changes.execute',
    ]);
    expect(fixture.base.captures).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
  });
  it('keeps GitHub on its legacy route after the original explicit read', async () => {
    await mount({ context: 'github' }, nativeRoot, true);
    await fireEvent.click(screen.getByRole('button', { name: 'Start a review' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Auto-fill & Create' }));
    await screen.findByText('Controlled legacy failure');
    expect(fixture.legacyRequests.map((r) => r.method)).toEqual([
      'accept-changes.prepare',
      'accept-changes.execute',
    ]);
    expect(fixture.captures).toHaveLength(0);
  });
  it('never falls back to legacy writes for an unknown qualified repository', async () => {
    await mount({ context: 'selection-required' }, nativeRoot, true);
    await fireEvent.click(screen.getByRole('button', { name: 'Start a review' }));
    await screen.findByText(
      'This review cannot be prepared with the current repository and access.',
    );
    expect(screen.queryByRole('button', { name: 'Auto-fill & Create' })).toBeNull();
    expect(fixture.legacyRequests).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
  });
});

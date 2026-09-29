import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { store, initAppStore } from '$store/renderer/store';
import { resetConfirmServiceForTests } from '$lib/components/patterns/confirm/confirm-service';
import { warmImport } from '../../../test/warm-import';
import {
  installSidebarNativeFixture,
  sidebarWorkspaceId,
  type SidebarFixtureOptions,
} from '../components/sidebar-native-review.preview-fixtures';
import {
  nativeReviewEditRequested,
  nativeReviewCompanionRequested,
  nativeReviewEditEnded,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { setPendingAutoAction } from '$store/renderer/slices/changes/changes-slice';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { selectNativeReviewForOwner } from '$store/renderer/slices/repository-context/repository-context-selectors';

warmImport(() => import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte'));
warmImport(() => import('$lib/components/patterns/confirm/ConfirmHost.svelte'));
let fixture: ReturnType<typeof installSidebarNativeFixture>;
let dispose: () => void;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  dispose = initAppStore(store).dispose;
  resetConfirmServiceForTests();
});
afterEach(async () => {
  cleanup();
  resetConfirmServiceForTests();
  await fixture?.dispose();
  dispose();
  vi.restoreAllMocks();
});
async function mount(options: SidebarFixtureOptions = {}) {
  fixture = installSidebarNativeFixture(options);
  render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
  const mounted = render(
    (await import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte')).default,
    { workspaceId: sidebarWorkspaceId },
  );
  if (options.role !== 'guest-owner')
    await fireEvent.click(await screen.findByTestId('pr-create-button'));
  if (
    options.role !== 'guest-owner' &&
    options.context !== 'unknown' &&
    options.context !== 'selection-required'
  )
    await screen.findByRole('textbox', { name: 'Target branch' });
  return mounted;
}
async function drafts(branch = 'release/literal ') {
  await fireEvent.input(screen.getByRole('textbox', { name: 'Target branch' }), {
    target: { value: branch },
  });
  await fireEvent.input(screen.getByRole('textbox', { name: 'Commit Message' }), {
    target: { value: 'Commit original staged files' },
  });
  await fireEvent.input(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Original review title' },
  });
  await fireEvent.input(screen.getByRole('textbox', { name: 'Description' }), {
    target: { value: 'Original review body' },
  });
}
async function commit(agree = true) {
  const region = screen.getByRole('region', { name: 'Create a merge request' });
  await fireEvent.click(within(region).getByRole('button', { name: 'Commit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Commit' });
  await fireEvent.click(within(dialog).getByRole('button', { name: agree ? 'Commit' : 'Cancel' }));
}
async function child(agree = true) {
  await fireEvent.click(await screen.findByRole('button', { name: 'Prepare merge request' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
  const dialog = await screen.findByRole('dialog', { name: 'Create this merge request?' });
  await fireEvent.click(within(dialog).getByRole('button', { name: agree ? 'Create' : 'Cancel' }));
}
function recordedActions<C extends (...args: never[]) => { type: string }>(
  dispatch: { mock: { calls: [unknown][] } },
  creator: C & { type: string },
): ReturnType<C>[] {
  return dispatch.mock.calls
    .map(([action]) => action)
    .filter(
      (action) =>
        typeof action === 'object' &&
        action !== null &&
        'type' in action &&
        action.type === creator.type,
    ) as ReturnType<C>[];
}
const commands = () => fixture.requests.filter((r) => r.kind === 'execute');

describe('explicit sidebar producer and queue through real Store/root sagas/Live captured IPC', () => {
  it('queues only its prepared original staged commit, then separately prepares and confirms its companion', async () => {
    await mount();
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    expect(fixture.captures).toHaveLength(0);
    await commit(false);
    expect(fixture.captures).toHaveLength(1);
    expect(commands()).toHaveLength(0);
    expect(fixture.captures[0].input).toEqual({
      workspaceId: sidebarWorkspaceId,
      action: 'commit',
      review: {
        root: { workspaceId: sidebarWorkspaceId, kind: 'primary' },
        choice: { kind: 'saved' },
        targetBranch: 'release/literal ',
        companion: { kind: 'create-pr' },
      },
    });
    const queued = recordedActions(dispatch, setPendingAutoAction).find(
      (action) => action.payload[1]?.action === 'native-review',
    );
    expect(queued).toBeDefined();
    const original = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
    const queuedIntent = queued?.payload[1];
    expect(queuedIntent?.action === 'native-review' ? queuedIntent.intent.owner : null).toEqual(
      original,
    );
    await commit();
    await screen.findByText('Completed commit: staged-parent-B');
    expect(fixture.captures).toHaveLength(1);
    expect(commands()).toHaveLength(1);
    await child(false);
    expect(commands()).toHaveLength(1);
    expect(fixture.captures[1].companionOf).toBe(fixture.captures[0].id);
    const companion = recordedActions(dispatch, nativeReviewCompanionRequested)[0].payload;
    expect(companion[0]).toEqual(original);
    expect(companion[1].attemptId).not.toBe(original.attemptId);
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Create',
      }),
    );
    await screen.findByText('Merge request created');
    expect(commands().map((r) => r.command)).toEqual([
      { commitMessage: 'Commit original staged files' },
      { prTitle: 'Original review title', prBody: 'Original review body' },
    ]);
    expect(
      fixture.readRequests.every((r) => !/stage|push|execute|update|branches/i.test(r.method)),
    ).toBe(true);
    expect(screen.getByText('Completed commit: staged-parent-B')).toBeTruthy();
  });
});

describe('original sidebar lifetime and truthful receipts', () => {
  it.each(['', '   '])('does not prepare an empty or whitespace target %j', async (branch) => {
    await mount();
    await drafts(branch);
    const button = within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole(
      'button',
      { name: 'Commit' },
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(button);
    expect(fixture.captures).toHaveLength(0);
    expect(commands()).toHaveLength(0);
  });
  it.each([false, true])(
    'preserves supplied branch unless explicitly overridden (%s)',
    async (override) => {
      await mount({ baseRef: 'release/saved' });
      const field = screen.getByRole('textbox', {
        name: 'Target branch',
      }) as HTMLInputElement;
      expect(field.value).toBe('release/saved');
      await drafts(override ? 'refs/heads/literal ' : 'release/saved');
      await commit(false);
      expect(fixture.captures[0].input?.review.targetBranch).toBe(
        override ? 'refs/heads/literal ' : 'release/saved',
      );
      expect(fixture.base.selectionRequests).toHaveLength(0);
      expect(fixture.readRequests.some((r) => /update|branches|save/i.test(r.method))).toBe(false);
    },
  );
  it('captures all text before deferred preparation and queues only the ready original preview', async () => {
    await mount({ delayPrepare: true });
    await drafts();
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    await waitFor(() => expect(fixture.captures).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commands()).toHaveLength(0);
    // Even a synthetic input event cannot change the immutable queued intent.
    await fireEvent.input(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Late reactive title' },
    });
    fixture.captures[0].finish();
    await fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Commit',
      }),
    );
    await screen.findByText('Completed commit: staged-parent-B');
    await fireEvent.click(screen.getByRole('button', { name: 'Prepare merge request' }));
    await waitFor(() => expect(fixture.captures).toHaveLength(2));
    fixture.captures[1].finish();
    await fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Original review title');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(commands()).toHaveLength(2));
    expect(commands()[1].command?.prTitle).toBe('Original review title');
  });
  it('retires unused preparation before a changed target and requires a distinct owner and confirmation', async () => {
    await mount();
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await commit(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Change target branch' }));
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'Original review title',
    );
    await fireEvent.input(screen.getByRole('textbox', { name: 'Target branch' }), {
      target: { value: 'release/changed' },
    });
    await commit(false);
    const owners = recordedActions(dispatch, nativeReviewEditRequested).map((a) => a.payload[0]);
    expect(owners).toHaveLength(2);
    expect(owners[0].attemptId).not.toBe(owners[1].attemptId);
    expect(fixture.captures[1].input?.review.targetBranch).toBe('release/changed');
    expect(commands()).toHaveLength(0);
  });
  it('a stale first dialog cannot execute after original host replacement', async () => {
    await mount();
    await drafts();
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    fixture.base.admit('host-B');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Commit' }));
    expect(commands()).toHaveLength(0);
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
  });
  it('late original capture after unmount is released without enqueue or execution', async () => {
    const mounted = await mount({ delayPrepare: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    await waitFor(() => expect(fixture.captures).toHaveLength(1));
    mounted.unmount();
    fixture.captures[0].finish();
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(commands()).toHaveLength(0);
    expect(
      recordedActions(dispatch, setPendingAutoAction).filter(
        (a) => a.payload[1]?.action === 'native-review',
      ),
    ).toHaveLength(0);
  });
  it.each(['failed', 'uncertain', 'pending'] as const)(
    'keeps the original commit after child %s without replacement work',
    async (scene) => {
      await mount({ scene });
      await drafts();
      await commit();
      await child();
      await waitFor(() => expect(commands()).toHaveLength(2));
      expect(screen.getByText('Completed commit: staged-parent-B')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Change target branch' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Prepare merge request' })).toBeNull();
      expect(fixture.captures).toHaveLength(2);
    },
  );
  it('keeps the parent receipt when companion preparation is refused', async () => {
    await mount({ refuseChild: true });
    await drafts();
    await commit();
    await fireEvent.click(await screen.findByRole('button', { name: 'Prepare merge request' }));
    await screen.findByText(
      'This review cannot be prepared with the current repository and access.',
    );
    expect(screen.getByText('Completed commit: staged-parent-B')).toBeTruthy();
    expect(commands()).toHaveLength(1);
    expect(fixture.captures).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });
  it('rejected original Check retains both the parent receipt and original child uncertainty', async () => {
    await mount({ scene: 'uncertain', refuseCheck: true });
    await drafts();
    await commit();
    await child();
    await fireEvent.click(await screen.findByRole('button', { name: 'Check result' }));
    await waitFor(() =>
      expect(fixture.requests.filter((r) => r.kind === 'reconcile')).toHaveLength(1),
    );
    expect(screen.getByText('Completed commit: staged-parent-B')).toBeTruthy();
    expect(screen.getAllByText(/The result is uncertain/).length).toBeGreaterThan(0);
    expect(commands()).toHaveLength(2);
    expect(fixture.captures).toHaveLength(2);
  });
  it('late claimed parent completion remains private in its exact closed owner after unmount', async () => {
    const mounted = await mount({ delayCommand: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await commit();
    await waitFor(() => expect(commands()).toHaveLength(1));
    const owner = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
    mounted.unmount();
    commands()[0].finish();
    await waitFor(() =>
      expect(
        getItem(store.state.repositoryContext.nativeReviewAttempts!, owner.attemptId)?.observation
          ?.execute?.success,
      ).toBe(true),
    );
    expect(selectNativeReviewForOwner.select(store.state, owner)).toBeNull();
    expect(
      getItem(store.state.repositoryContext.nativeReviewAttempts!, owner.attemptId)?.observation
        ?.execute?.reviewExecution?.gitReceipts,
    ).toEqual([{ stage: 'commit', commitHash: 'staged-parent-B' }]);
    expect(fixture.captures).toHaveLength(1);
  });
  it('a published child retains its own lease after ordinary parent retirement', async () => {
    await mount();
    await drafts();
    await commit();
    await fireEvent.click(await screen.findByRole('button', { name: 'Prepare merge request' }));
    await screen.findByRole('button', { name: 'Create' });
    fixture.retire('admission', 0);
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Create',
      }),
    );
    await screen.findByText('Merge request created');
    expect(commands()).toHaveLength(2);
  });
  it('explicit parent end without a published child cannot gain continuation from retained receipt', async () => {
    await mount();
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await commit();
    await screen.findByText('Completed commit: staged-parent-B');
    const owner = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
    store.dispatch(nativeReviewEditEnded(owner));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Prepare merge request' })).toBeNull(),
    );
    expect(fixture.captures).toHaveLength(1);
    expect(
      getItem(store.state.repositoryContext.nativeReviewAttempts!, owner.attemptId)?.observation
        ?.execute,
    ).toBeTruthy();
  });
  it('Member preparation omits connection/account facts and renders actual review metadata', async () => {
    await mount({ role: 'member', scene: 'reused' });
    await drafts();
    await commit();
    await child();
    await screen.findByText('Existing merge request reused');
    expect(screen.getByText('Target branch: Unknown')).toBeTruthy();
    expect(fixture.captures[0].preview.reviewPreparation).not.toHaveProperty('connection');
    expect(screen.getByRole('link', { name: 'Actual remote review title' })).toBeTruthy();
    expect(screen.getAllByText(/Local commits are ahead/).length).toBeGreaterThan(0);
  });
  it.each([
    { role: 'guest-owner' as const },
    { context: 'unknown' as const },
    { context: 'selection-required' as const },
  ])('refuses unqualified authority/target without a legacy write: %j', async (options) => {
    await mount(options);
    await screen.findByText(
      'This review cannot be prepared with the current repository and access.',
    );
    expect(fixture.captures).toHaveLength(0);
    expect(commands()).toHaveLength(0);
    expect(fixture.readRequests.some((r) => /execute|stage|push|update/i.test(r.method))).toBe(
      false,
    );
  });
});

describe('original target and child completion boundaries', () => {
  it('shows original execution failure without a review payload and keeps only original Check available', async () => {
    await mount({ delayCommand: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await commit();
    await waitFor(() => expect(commands()).toHaveLength(1));
    const request = commands()[0];
    request.finish({
      current: true,
      uncertain: false,
      reconciliation: null,
      execute: {
        operationId: request.id,
        root: request.root,
        state: 'pending',
        success: false,
        error: 'Original commit did not report completion',
        steps: [{ id: 'commit', name: 'Commit', status: 'failed', error: 'Original step failed' }],
      },
    });
    const owner = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
    await waitFor(() =>
      expect(
        getItem(store.state.repositoryContext.nativeReviewAttempts!, owner.attemptId)?.observation
          ?.execute?.error,
      ).toBe('Original commit did not report completion'),
    );
    const original = await screen.findByRole('region', { name: 'Original execution' });
    expect(within(original).getByText('Original commit did not report completion')).toBeTruthy();
    expect(within(original).getByText('Original step failed')).toBeTruthy();
    expect(within(original).getByText('This execution did not report success.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check result' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prepare merge request' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change target branch' })).toBeNull();
    expect(commands()).toHaveLength(1);
    expect(fixture.captures).toHaveLength(1);
  });
  it('labels the original child execution separately from its explicit later result check', async () => {
    await mount({ scene: 'uncertain' });
    await drafts();
    await commit();
    await child();
    await fireEvent.click(await screen.findByRole('button', { name: 'Check result' }));
    const checked = await screen.findByRole('region', { name: 'Original result check' });
    await within(checked).findByText('Existing merge request reused');
    const executions = screen.getAllByRole('region', { name: 'Original execution' });
    expect(executions).toHaveLength(2);
    expect(within(executions[0]).getByText('Completed commit: staged-parent-B')).toBeTruthy();
    expect(within(executions[1]).getByText(/The result is uncertain/)).toBeTruthy();
    expect(within(executions[1]).queryByText('Existing merge request reused')).toBeNull();
    expect(commands()).toHaveLength(2);
    expect(fixture.requests.filter((r) => r.kind === 'reconcile').map((r) => r.id)).toEqual([
      fixture.captures[1].id,
    ]);
    expect(fixture.captures).toHaveLength(2);
  });
  it.each(['bad..ref', 'missing/branch', 'feature/details'])(
    'retains every draft after controlled preparation refusal for %s',
    async (branch) => {
      await mount({ refusePrepare: true });
      await drafts(branch);
      await fireEvent.click(
        within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
          name: 'Commit',
        }),
      );
      await screen.findByText(
        'This review cannot be prepared with the current repository and access.',
      );
      expect(fixture.captures[0].input?.review.targetBranch).toBe(branch);
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
        'Original review title',
      );
      expect(
        (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
      ).toBe('Original review body');
      expect(commands()).toHaveLength(0);
      expect(screen.queryByRole('dialog')).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Change target branch' }));
      expect(
        (screen.getByRole('textbox', { name: 'Target branch' }) as HTMLInputElement).value,
      ).toBe(branch);
    },
  );
  it('retires an unused owner when its original read context ends during capture', async () => {
    await mount({ delayPrepare: true });
    await drafts();
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    await waitFor(() => expect(fixture.captures).toHaveLength(1));
    fixture.base.retire();
    await screen.findByText(
      'Repository details changed. Start a review again to check your target branch.',
    );
    fixture.captures[0].finish();
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(commands()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('the child confirmation displays its original returned destination without rereading drafts', async () => {
    await mount({ delayPrepare: true });
    await drafts();
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole('button', {
        name: 'Commit',
      }),
    );
    await waitFor(() => expect(fixture.captures).toHaveLength(1));
    fixture.captures[0].finish();
    await fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Commit' }),
    );
    await fireEvent.click(await screen.findByRole('button', { name: 'Prepare merge request' }));
    await waitFor(() => expect(fixture.captures).toHaveLength(2));
    const target = fixture.captures[1].preview.reviewPreparation.target;
    target.repository = { ...target.repository, projectPath: 'actual/child-project' };
    target.branch = 'actual/child-branch';
    fixture.captures[1].finish();
    await fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('actual/child-project');
    expect(dialog.textContent).toContain('actual/child-branch');
    expect(dialog.textContent).toContain('Original review title');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(commands()).toHaveLength(1);
    expect(screen.getByText('Completed commit: staged-parent-B')).toBeTruthy();
  });
  it('late child execution belongs to its closed original owner and preserves its separate parent', async () => {
    const mounted = await mount({ delayCommand: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    await drafts();
    await commit();
    await waitFor(() => expect(commands()).toHaveLength(1));
    commands()[0].finish();
    await child();
    await waitFor(() => expect(commands()).toHaveLength(2));
    const [parent, childOwner] = recordedActions(dispatch, nativeReviewCompanionRequested)[0]
      .payload;
    mounted.unmount();
    commands()[1].finish();
    await waitFor(() =>
      expect(
        getItem(store.state.repositoryContext.nativeReviewAttempts!, childOwner.attemptId)
          ?.observation?.execute?.success,
      ).toBe(true),
    );
    expect(selectNativeReviewForOwner.select(store.state, parent)).toBeNull();
    expect(selectNativeReviewForOwner.select(store.state, childOwner)).toBeNull();
    expect(
      getItem(store.state.repositoryContext.nativeReviewAttempts!, parent.attemptId)?.observation
        ?.execute?.reviewExecution?.gitReceipts,
    ).toEqual([{ stage: 'commit', commitHash: 'staged-parent-B' }]);
    expect(
      getItem(store.state.repositoryContext.nativeReviewAttempts!, childOwner.attemptId)
        ?.observation?.execute?.reviewExecution?.gitReceipts,
    ).toEqual([]);
    expect(fixture.captures).toHaveLength(2);
  });
});

import { tick } from 'svelte';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  principalContextChanged,
  principalIdentityChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import {
  setWorkspaceHasLoaded,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
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
  repositoryContextDemanded,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { setPendingAutoAction } from '$store/renderer/slices/changes/changes-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectAcceptChangesStatus,
  selectPostMergeState,
} from '$store/renderer/slices/git/git-selectors';
import {
  selectAcceptChangesState,
  selectStagedWorkingChanges,
} from '$store/renderer/slices/changes/changes-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import type { ComponentProps } from 'svelte';
import PRSection from '$lib/components/workspace/sidebar/PRSection.svelte';
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
    options.context !== 'mixed-providers' &&
    options.context !== 'selection-required'
  )
    await screen.findByRole('textbox', { name: 'Target branch' });
  return mounted;
}
it('saves a mixed-provider remote immediately and refreshes the PR destination without a dialog', async () => {
  await mount({ context: 'mixed-providers' });
  const choose = async (key: 'Home' | 'End') => {
    const control = await screen.findByRole('combobox', { name: 'PR repository' });
    await fireEvent.click(control);
    await screen.findByRole('option', { name: /origin · GitLab/ });
    await fireEvent.keyDown(control, { key });
    await fireEvent.keyDown(control, { key: 'Enter' });
  };
  await choose('Home');
  await screen.findByRole('textbox', { name: 'Target branch' });
  expect(fixture.base.selectionRequests[0]).toMatchObject({
    kind: 'confirm',
    root: { workspaceId: sidebarWorkspaceId, kind: 'primary' },
    command: { kind: 'save', choice: { mode: 'explicit-remote', remoteName: 'origin' } },
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  await choose('End');
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Target branch' })).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'PR repository' }).textContent).toContain(
      'github · GitHub',
    ),
  );
  expect(fixture.base.selectionRequests[1].command).toEqual({
    kind: 'save',
    choice: { mode: 'explicit-remote', remoteName: 'github' },
  });
  expect(fixture.requests).toHaveLength(0);
  await fireEvent.click(screen.getByTestId('pr-create-button'));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel', exact: true })).toBeNull(),
  );
  await fireEvent.click(screen.getByTestId('pr-create-button'));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'PR repository' }).textContent).toContain(
      'github · GitHub',
    ),
  );
});

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
  await waitFor(() => {
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'Original review title',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
    ).toBe('Original review body');
    const button = within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole(
      'button',
      { name: 'Commit' },
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(!branch.trim());
  });
}
async function commit(agree = true) {
  const region = screen.getByRole('region', { name: 'Create a merge request' });
  const button = within(region).getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  await fireEvent.click(button);
  await waitFor(() => expect(fixture.captures.length).toBeGreaterThan(0));
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
  it('keeps the title when the description is edited before the next store notification', async () => {
    await mount();
    await drafts();
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
        'Original review title',
      );
      expect(
        (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value,
      ).toBe('Original review body');
      expect(
        (
          within(screen.getByRole('region', { name: 'Create a merge request' })).getByRole(
            'button',
            { name: 'Commit' },
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    expect(fixture.captures).toHaveLength(0);
  });
  it.each([
    ['description edit', 'Original review title', 'Latest review body'],
    ['title and description edit', 'Latest review title', 'Latest review body'],
    ['description cleared', 'Original review title', ''],
  ])(
    'captures the canonical draft before a renderer notification: %s',
    async (_name, title, body) => {
      await mount();
      await drafts();
      const titleField = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
      const bodyField = screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
      const commitButton = within(
        screen.getByRole('region', { name: 'Create a merge request' }),
      ).getByRole('button', { name: 'Commit' });

      // Input reducers run immediately; the component's selector notification may arrive later.
      titleField.value = title;
      titleField.dispatchEvent(new Event('input', { bubbles: true }));
      bodyField.value = body;
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
      expect(selectAcceptChangesState.select(store.state, sidebarWorkspaceId)).toMatchObject({
        prTitle: title,
        prDescription: body,
      });
      commitButton.click();

      const dialog = await screen.findByRole('dialog', { name: 'Commit' });
      expect(commands()).toHaveLength(0);
      await fireEvent.click(within(dialog).getByRole('button', { name: 'Commit' }));
      await screen.findByText('Completed commit: staged-parent-B');
      await child();
      await screen.findByText('Merge request created');
      expect(commands().map((request) => request.command)).toEqual([
        { commitMessage: 'Commit original staged files' },
        { prTitle: title, prBody: body },
      ]);
    },
  );

  it('rejects a title cleared before the renderer disables preparation', async () => {
    await mount();
    await drafts();
    const titleField = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    const commitButton = within(
      screen.getByRole('region', { name: 'Create a merge request' }),
    ).getByRole('button', { name: 'Commit' });
    titleField.value = '   ';
    titleField.dispatchEvent(new Event('input', { bubbles: true }));
    expect(selectAcceptChangesState.select(store.state, sidebarWorkspaceId).prTitle).toBe('   ');
    commitButton.click();
    await tick();
    expect(fixture.captures).toHaveLength(0);
    expect(commands()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

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

// These controls wait for the real status worker before looking for the native entry.
async function mountWithoutOrigin(options: SidebarFixtureOptions = {}, labs = true) {
  fixture = installSidebarNativeFixture({ ...options, withoutOrigin: true, baseRef: 'trunk' });
  if (!labs) store.dispatch(setLabsMultiplayerEnabled(false));
  render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
  const mounted = render(
    (await import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte')).default,
    { workspaceId: sidebarWorkspaceId },
  );
  if (options.role !== 'guest-owner' && options.role !== 'stale-guest') {
    await waitFor(() => {
      expect(selectAcceptChangesStatus.select(store.state, sidebarWorkspaceId)).toMatchObject({
        hasRemote: false,
        remoteUrl: null,
      });
      expect(selectPostMergeState.select(store.state, sidebarWorkspaceId).hasRemote).toBe(false);
      // The Labs-off demand refusal does not require a retained admitted file read.
      if (labs)
        expect(selectStagedWorkingChanges.select(store.state, sidebarWorkspaceId)).toHaveLength(1);
    });
  }
  return mounted;
}
async function resolveNamedRemote() {
  await waitFor(() => expect(fixture.base.reads.length).toBeGreaterThan(0));
  fixture.finishContext();
}
async function openNamedRemote() {
  await resolveNamedRemote();
  await fireEvent.click(await screen.findByTestId('pr-create-button'));
  await screen.findByRole('textbox', { name: 'Target branch' });
}

describe('native entry after delivered false origin status', () => {
  it.each(['owner', 'member'] as const)(
    'opens the saved named-remote entry for %s and confirms each original operation separately',
    async (role) => {
      await mountWithoutOrigin({ role });
      const dispatch = vi.spyOn(store, 'dispatch');
      await openNamedRemote();
      expect(
        (screen.getByRole('textbox', { name: 'Target branch' }) as HTMLInputElement).value,
      ).toBe('trunk');
      await drafts('release/literal ');
      await commit(false);
      expect(commands()).toHaveLength(0);
      expect(fixture.captures).toHaveLength(1);
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
      const owner = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
      const queued = recordedActions(dispatch, setPendingAutoAction).find(
        (a) => a.payload[1]?.action === 'native-review',
      )?.payload[1];
      expect(queued?.action === 'native-review' ? queued.intent.owner : null).toEqual(owner);
      await commit();
      await screen.findByText('Completed commit: staged-parent-B');
      await child(false);
      expect(commands()).toHaveLength(1);
      expect(fixture.captures[1].companionOf).toBe(fixture.captures[0].id);
      const pair = recordedActions(dispatch, nativeReviewCompanionRequested)[0].payload;
      expect(pair[0]).toEqual(owner);
      expect(pair[1].attemptId).not.toBe(owner.attemptId);
      await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      await fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }),
      );
      await screen.findByText('Merge request created');
      expect(commands().map((r) => r.command)).toEqual([
        { commitMessage: 'Commit original staged files' },
        { prTitle: 'Original review title', prBody: 'Original review body' },
      ]);
      expect(fixture.base.selectionRequests).toHaveLength(0);
      expect(
        fixture.readRequests.some((r) => /stage|push|execute|update|branches/i.test(r.method)),
      ).toBe(false);
    },
  );
  it.each(['unknown', 'selection-required', 'loading'] as const)(
    'does not turn the no-origin %s read into command authority',
    async (context) => {
      await mountWithoutOrigin({ context });
      await waitFor(() => expect(fixture.base.reads.length).toBeGreaterThan(0));
      if (context !== 'loading') {
        fixture.finishContext();
        await screen.findByText(
          'This review cannot be prepared with the current repository and access.',
        );
      } else {
        expect(screen.queryByRole('textbox', { name: 'Target branch' })).toBeNull();
      }
      expect(fixture.captures).toHaveLength(0);
      expect(commands()).toHaveLength(0);
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
  it.each(['guest-owner', 'stale-guest'] as const)(
    'refuses no-origin %s admission without starting command work',
    async (role) => {
      await mountWithoutOrigin({ role });
      if (role === 'guest-owner')
        await screen.findByText(
          'This review cannot be prepared with the current repository and access.',
        );
      expect(selectWorkspaceActionContext.select(store.state, sidebarWorkspaceId)).toBeNull();
      expect(fixture.base.captures).toHaveLength(0);
      expect(screen.queryByTestId('pr-create-button')).toBeNull();
      expect(fixture.captures).toHaveLength(0);
      expect(commands()).toHaveLength(0);
    },
  );
  it('keeps GitHub origin-dependent after the original context resolves', async () => {
    await mountWithoutOrigin({ context: 'github' });
    await resolveNamedRemote();
    await waitFor(() => expect(screen.queryByTestId('pr-create-button')).toBeNull());
    expect(screen.queryByRole('textbox', { name: 'Target branch' })).toBeNull();
    expect(fixture.captures).toHaveLength(0);
    expect(commands()).toHaveLength(0);
  });
  it('keeps Labs-off entry origin-dependent without a native demand', async () => {
    await mountWithoutOrigin({}, false);
    expect(screen.queryByTestId('pr-create-button')).toBeNull();
    expect(fixture.base.captures).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
  });
  it.each(['close', 'unmount', 'host', 'admission', 'workspace', 'mode'] as const)(
    'ends the original no-origin demand and unused owner on %s',
    async (change) => {
      const mounted = await mountWithoutOrigin();
      await openNamedRemote();
      const dispatch = vi.spyOn(store, 'dispatch');
      await drafts();
      await commit(false);
      const owner = recordedActions(dispatch, nativeReviewEditRequested)[0].payload[0];
      const original = fixture.base.captures[0].id;
      if (change === 'close') await fireEvent.click(screen.getByTestId('pr-create-button'));
      if (change === 'unmount') mounted.unmount();
      if (change === 'host') fixture.base.admit('host-B');
      if (change === 'admission') fixture.grant('guest-owner');
      if (change === 'workspace')
        await mounted.rerender({ workspaceId: 'another-original-workspace' });
      if (change === 'mode') store.dispatch(setLabsMultiplayerEnabled(false));
      await waitFor(() => expect(fixture.base.releases).toContain(original));
      await waitFor(() => expect(fixture.releases).toContain(fixture.captures[0].id));
      expect(selectNativeReviewForOwner.select(store.state, owner)).toBeNull();
      expect(commands()).toHaveLength(0);
      expect(fixture.captures).toHaveLength(1);
    },
  );
  it.each([true, false])(
    'keeps listOnly=%s and non-opted-in callers origin-dependent',
    async (listOnly) => {
      fixture = installSidebarNativeFixture({ withoutOrigin: true });
      const props: ComponentProps<typeof PRSection> = {
        workspaceId: sidebarWorkspaceId,
        nativeReview: listOnly,
        listOnly,
        hasStaged: true,
        hasUnstaged: false,
        hasCommits: false,
        hasOpenPR: false,
        hasRemote: false,
        hasPRs: false,
        pullRequests: [],
        commits: [],
        pushedCommits: [],
        allCommits: [],
        stagedChanges: [],
        trunkBranch: 'trunk',
        targetBranch: 'trunk',
        repoPath: '/fixture',
        repoType: 'local',
        commitMessage: 'Original',
        hasUnpushedCommits: false,
        unpushedCount: 0,
        hasPushedCommits: false,
        isDiverged: false,
        isBehind: false,
        behindCount: 0,
        isMergedToTrunk: false,
        areAllPRsMerged: false,
        hasResetToTrunk: false,
        isContentMergedToTrunk: false,
        hasNewWorkAfterMerge: false,
        isPRMerged: false,
        mergeDrawerOpen: false,
        onMergeDrawerToggle: () => {},
      };
      render(PRSection, props);
      expect(screen.queryByTestId('pr-create-button')).toBeNull();
      expect(fixture.base.captures).toHaveLength(0);
      expect(fixture.captures).toHaveLength(0);
    },
  );
});

describe('origin status delivery preserves original command ownership', () => {
  it.each([false, true])(
    'late origin status keeps the original read and owner (claimed %s)',
    async (claimed) => {
      fixture = installSidebarNativeFixture({
        withoutOrigin: true,
        delayStatus: true,
        baseRef: 'trunk',
      });
      render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
      render(
        (await import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte')).default,
        { workspaceId: sidebarWorkspaceId },
      );
      await waitFor(() => {
        expect(selectStagedWorkingChanges.select(store.state, sidebarWorkspaceId)).toHaveLength(1);
        expect(fixture.statusReplies).toHaveLength(1);
      });
      await fireEvent.click(await screen.findByTestId('pr-create-button'));
      await resolveNamedRemote();
      await screen.findByRole('textbox', { name: 'Target branch' });
      await drafts();
      await commit(false);
      const context = fixture.base.captures[0].id;
      const parent = fixture.captures[0].id;
      if (claimed) {
        await commit();
        await screen.findByText('Completed commit: staged-parent-B');
      }
      fixture.statusReplies[0].finish();
      await waitFor(() =>
        expect(selectPostMergeState.select(store.state, sidebarWorkspaceId).hasRemote).toBe(false),
      );
      expect(selectAcceptChangesStatus.select(store.state, sidebarWorkspaceId)).toMatchObject({
        hasRemote: false,
        remoteUrl: null,
      });
      expect(fixture.base.captures).toHaveLength(1);
      expect(fixture.base.releases).not.toContain(context);
      expect(fixture.releases).not.toContain(parent);
      expect(fixture.captures).toHaveLength(1);
      if (!claimed) await commit();
      await screen.findByText('Completed commit: staged-parent-B');
      expect(screen.getByRole('button', { name: 'Prepare merge request' })).toBeTruthy();
      expect(commands()).toHaveLength(1);
      expect(fixture.captures).toHaveLength(1);
    },
  );
});

describe('admitted Guest sidebar refusal without command authority', () => {
  it.each([true, false])(
    'shows passive refusal to admitted collaborator Guest (withoutOrigin=%s)',
    async (withoutOrigin) => {
      fixture = installSidebarNativeFixture({ role: 'collaborator', withoutOrigin });
      const dispatch = vi.spyOn(store, 'dispatch');
      render((await import('$lib/components/patterns/confirm/ConfirmHost.svelte')).default);
      const mounted = render(
        (await import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte')).default,
        { workspaceId: sidebarWorkspaceId },
      );
      expect(selectWorkspaceActionContext.select(store.state, sidebarWorkspaceId)).toBeNull();
      expect(store.state.workspace.capabilityContext).not.toBeNull();
      await screen.findByText(
        'This review cannot be prepared with the current repository and access.',
      );
      expect(screen.queryByTestId('pr-create-button')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fixture.base.captures).toHaveLength(0);
      expect(fixture.captures).toHaveLength(0);
      expect(fixture.requests).toHaveLength(0);
      expect(recordedActions(dispatch, repositoryContextDemanded)).toHaveLength(0);
      expect(recordedActions(dispatch, nativeReviewEditRequested)).toHaveLength(0);
      expect(recordedActions(dispatch, setPendingAutoAction)).toHaveLength(0);
      expect(fixture.base.selectionRequests).toHaveLength(0);
      mounted.unmount();
      expect(fixture.base.releases).toHaveLength(0);
      expect(fixture.releases).toHaveLength(0);
    },
  );
});

async function renderGuestSection(overrides: Partial<ComponentProps<typeof PRSection>> = {}) {
  const props: ComponentProps<typeof PRSection> = {
    workspaceId: sidebarWorkspaceId,
    nativeReview: true,
    listOnly: false,
    hasStaged: true,
    hasUnstaged: false,
    hasCommits: false,
    hasOpenPR: false,
    hasRemote: false,
    hasPRs: false,
    pullRequests: [],
    commits: [],
    pushedCommits: [],
    allCommits: [],
    stagedChanges: [],
    trunkBranch: 'trunk',
    targetBranch: 'trunk',
    repoPath: '/fixture',
    repoType: 'local',
    commitMessage: 'Original',
    hasUnpushedCommits: false,
    unpushedCount: 0,
    hasPushedCommits: false,
    isDiverged: false,
    isBehind: false,
    behindCount: 0,
    isMergedToTrunk: false,
    areAllPRsMerged: false,
    hasResetToTrunk: false,
    isContentMergedToTrunk: false,
    hasNewWorkAfterMerge: false,
    isPRMerged: false,
    mergeDrawerOpen: false,
    onMergeDrawerToggle: () => {},
  };

  return render(PRSection, { ...props, isOwner: false, ...overrides });
}

describe('passive refusal admission and default isolation', () => {
  it('waits for the current Guest workspace admission after a same-backend Member transition', async () => {
    fixture = installSidebarNativeFixture({ role: 'member', withoutOrigin: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    const mounted = render(
      (await import('$lib/components/workspace/sidebar/SidebarChangesPanel.svelte')).default,
      { workspaceId: sidebarWorkspaceId },
    );
    const originalBackend = store.state.connections.windowBackendId;
    const originalAdmission = selectPrincipalActionContext.select(store.state);
    const snapshot = store.state.principal.snapshot!;
    store.dispatch(principalIdentityChanged(snapshot.principal.id));
    const read = store.state.principal;
    store.dispatch(
      principalReceived(
        {
          context: read.context!,
          invalidation: read.invalidation,
          presentationVersion: read.presentationVersion,
        },
        {
          ...snapshot,
          principal: { ...snapshot.principal, hostRole: 'guest', isAdministrator: false },
        },
      ),
    );
    store.dispatch(
      setWorkspaceEntity({
        ...selectWorkspaceById.select(store.state, sidebarWorkspaceId)!,
        myRole: 'collaborator',
        canManage: false,
      }),
    );
    await tick();
    expect(store.state.workspace.capabilityContext).toBe(originalAdmission);
    expect(selectPrincipalActionContext.select(store.state)).not.toBe(originalAdmission);
    expect(
      screen.queryByText('This review cannot be prepared with the current repository and access.'),
    ).toBeNull();
    store.dispatch(
      setWorkspaceHasLoaded(
        true,
        originalBackend,
        selectPrincipalActionContext.select(store.state),
      ),
    );
    await screen.findByText(
      'This review cannot be prepared with the current repository and access.',
    );
    expect(store.state.connections.windowBackendId).toBe(originalBackend);
    expect(screen.queryByTestId('pr-create-button')).toBeNull();
    expect(fixture.base.captures).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
    expect(recordedActions(dispatch, repositoryContextDemanded)).toHaveLength(0);
    expect(recordedActions(dispatch, nativeReviewEditRequested)).toHaveLength(0);
    expect(recordedActions(dispatch, setPendingAutoAction)).toHaveLength(0);
    expect(fixture.base.selectionRequests).toHaveLength(0);
    mounted.unmount();
    expect(fixture.base.releases).toHaveLength(0);
  });
  it.each([
    'unknown',
    'loading',
    'disconnected',
    'stale',
    'labs-off',
    'list-only',
    'not-opted-in',
  ] as const)('does not add refusal or authority for %s collaborator state', async (state) => {
    fixture = installSidebarNativeFixture({ role: 'collaborator', withoutOrigin: true });
    const dispatch = vi.spyOn(store, 'dispatch');
    if (state === 'unknown') store.dispatch(principalContextChanged(null));
    if (state === 'disconnected')
      store.dispatch(
        connectionsListReceived({
          connections: [],
          activeId: 'other-host',
          windowBackendId: 'other-host',
        }),
      );
    if (state === 'loading')
      store.dispatch(principalIdentityChanged(store.state.principal.snapshot!.principal.id));
    if (state === 'stale')
      store.dispatch(
        setWorkspaceHasLoaded(true, store.state.connections.windowBackendId, 'old-admission'),
      );
    if (state === 'labs-off') store.dispatch(setLabsMultiplayerEnabled(false));
    await renderGuestSection({
      listOnly: state === 'list-only',
      nativeReview: state !== 'not-opted-in',
    });
    await tick();
    expect(
      screen.queryByText('This review cannot be prepared with the current repository and access.'),
    ).toBeNull();
    expect(screen.queryByTestId('pr-create-button')).toBeNull();
    expect(fixture.base.captures).toHaveLength(0);
    expect(fixture.captures).toHaveLength(0);
    expect(fixture.requests).toHaveLength(0);
    expect(recordedActions(dispatch, repositoryContextDemanded)).toHaveLength(0);
    expect(recordedActions(dispatch, nativeReviewEditRequested)).toHaveLength(0);
    expect(recordedActions(dispatch, setPendingAutoAction)).toHaveLength(0);
    expect(fixture.base.selectionRequests).toHaveLength(0);
  });
});

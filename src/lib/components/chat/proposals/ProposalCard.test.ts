/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const lifecycleSelectorState = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'applying' | 'applied' | 'undoing' | 'failed',
  error: null as string | null,
  errorCode: null as string | null,
  result: null as { workspaceId?: string } | null,
}));

const historySelectorState = vi.hoisted(() => ({
  settingsApplied: null as null | { appliedAt: number; reverseChanges: unknown[] },
  specialistApplied: null as null | { appliedAt: number; reverse: unknown },
}));

const navigationMocks = vi.hoisted(() => ({
  goto: vi.fn(),
}));

const electronBridgeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: electronBridgeMocks.invoke,
}));

const prBranchLookupState = vi.hoisted(() => {
  type Entry = { status: 'loading' | 'succeeded' | 'failed'; branch?: string; error?: string };
  const lookupEntries: Record<string, Entry | undefined> = {};
  const subscribers = new Set<(value: Record<string, Entry | undefined>) => void>();
  const dispatch = vi.fn();

  function emit() {
    for (const subscriber of subscribers) subscriber(lookupEntries);
  }

  function reset() {
    for (const key of Object.keys(lookupEntries)) delete lookupEntries[key];
    subscribers.clear();
    dispatch.mockClear();
  }

  function selectPrBranchLookupEntries() {
    return {
      subscribe(run: (value: Record<string, Entry | undefined>) => void) {
        subscribers.add(run);
        run(lookupEntries);
        return () => {
          subscribers.delete(run);
        };
      },
    };
  }

  return { dispatch, lookupEntries, emit, reset, selectPrBranchLookupEntries };
});

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/SpecialistDropdown.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'))
    .default,
}));
vi.mock(
  '$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors',
  () => ({
    selectProposalAppliedState: vi.fn(() => ({
      subscribe: (run: (value: typeof historySelectorState.settingsApplied) => void) => {
        run(historySelectorState.settingsApplied);
        return () => {};
      },
    })),
  }),
);
vi.mock(
  '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors',
  () => ({
    selectSpecialistProposalAppliedState: vi.fn(() => ({
      subscribe: (run: (value: typeof historySelectorState.specialistApplied) => void) => {
        run(historySelectorState.specialistApplied);
        return () => {};
      },
    })),
  }),
);
vi.mock('$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors', () => ({
  selectProposalStatus: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.status) => void) => {
      run(lifecycleSelectorState.status);
      return () => {};
    },
  })),
  selectProposalError: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.error) => void) => {
      run(lifecycleSelectorState.error);
      return () => {};
    },
  })),
  selectProposalErrorCode: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.errorCode) => void) => {
      run(lifecycleSelectorState.errorCode);
      return () => {};
    },
  })),
  selectProposalResult: vi.fn(() => ({
    subscribe: (run: (value: typeof lifecycleSelectorState.result) => void) => {
      run(lifecycleSelectorState.result);
      return () => {};
    },
  })),
}));
vi.mock('$app/navigation', () => ({
  goto: navigationMocks.goto,
}));
vi.mock('$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-selectors', () => ({
  selectPrBranchLookupEntries: prBranchLookupState.selectPrBranchLookupEntries,
}));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: prBranchLookupState.dispatch,
    state: {},
    createSelector: vi.fn((fn) => ({
      select: fn,
      withStore: () => () => ({ subscribe: () => () => {} }),
    })),
  },
}));

import {
  getPrBranchLookupKey,
  prBranchLookupStarted,
} from '$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-slice';
import ProposalCard from './ProposalCard.svelte';
import { warmImport } from '../../../../test/warm-import';

const originalElectronAPI = window.electronAPI;

// Presence of window.electronAPI gates canUseElectronPrLookup(); the actual
// IPC call goes through the mocked $lib/electron-bridge invoke.
function setElectronEnv() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { invoke: vi.fn() },
  });
}

function clearElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

function getBranchPicker(): HTMLElement {
  const picker = screen
    .getAllByTestId('mock-repo-and-branch-picker')
    .find((item) => item.getAttribute('data-field') === 'branch');
  if (!picker) throw new Error('Branch picker not found');
  return picker;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  lifecycleSelectorState.status = 'idle';
  lifecycleSelectorState.error = null;
  lifecycleSelectorState.errorCode = null;
  lifecycleSelectorState.result = null;
  historySelectorState.settingsApplied = null;
  historySelectorState.specialistApplied = null;
  navigationMocks.goto.mockReset();
  electronBridgeMocks.invoke.mockReset();
  prBranchLookupState.reset();
});

afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: originalElectronAPI,
  });
});

function makeProposal(
  fields: Proposal['preview']['fields'],
  preview: Partial<Proposal['preview']> = {},
): Proposal {
  return {
    kind: 'bulk-op',
    payload: {},
    preview: {
      title: 'Change settings',
      fields,
      ...preview,
    },
  };
}

function makeSpecialistProposal(): Proposal {
  return {
    kind: 'specialist-edit',
    payload: { operation: 'edit', id: 'review-buddy' },
    preview: {
      title: 'Edit specialist: Review Buddy',
      summary: 'Review and edit the specialist fields before applying.',
      fields: [{ key: 'name', label: 'Name', before: 'Reviewer', after: 'Review Buddy' }],
    },
  };
}

function makeWorkspaceProposal(
  preview: Partial<Proposal['preview']> = {},
  params: Record<string, unknown> = {},
): Proposal {
  return {
    kind: 'workspace-create',
    payload: { operation: 'workspace.create', params },
    preview: {
      title: 'Create workspace: Review PR #647',
      ...preview,
    },
  };
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'));

describe('ProposalCard', () => {
  it('renders lifecycle progress, disabled controls, and aria-live status', () => {
    lifecycleSelectorState.status = 'applying';
    render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
      },
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Applying…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Applying…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders applied proposals as completed instead of actionable', () => {
    lifecycleSelectorState.status = 'applied';
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
        onApply,
        onDiscard,
      },
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Applied.');
    expect(status.className).toContain('text-success');
    expect(container.querySelector('[data-lifecycle-status="applied"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('keeps completed cards flat without a success border in the tray surface', () => {
    lifecycleSelectorState.status = 'applied';
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
      },
    });

    const card = container.querySelector('[data-proposal-kind]');
    expect(card?.className).not.toContain('border-success');
    expect(screen.getByRole('status').className).toContain('text-success');
  });

  it('renders a full-width flat surface without nested card chrome', () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
      },
    });

    const card = container.querySelector('[data-proposal-kind]');
    expect(card?.className).toContain('w-full');
    expect(card?.className).not.toContain('max-w-xl');
    expect(card?.className).not.toContain('border');
    expect(card?.className).not.toContain('shadow');
    expect(card?.className).not.toContain('bg-card');
    expect(screen.getByRole('heading', { name: 'Change settings' }).className).toContain(
      'type-body',
    );
    expect(container.innerHTML).not.toMatch(/(?:green|emerald)-[0-9]/);
  });

  it('shows Retry only on failed lifecycle and retries apply', async () => {
    lifecycleSelectorState.status = 'failed';
    lifecycleSelectorState.error = 'Nope';
    const onApply = vi.fn();
    render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
        onApply,
      },
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Action failed: Nope');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        editedFields: { title: 'Workspace title' },
        selectedBulkItemIds: [],
      }),
    );
  });

  it('shows a muted placeholder for an empty editable field and focuses an input on click', async () => {
    render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: '' }]),
      },
    });

    const row = screen.getByRole('button', { name: 'Edit Title' });
    const placeholder = screen.getByText('Add title…');

    expect(row.getAttribute('tabindex')).toBe('0');
    expect(placeholder.className).toContain('text-muted-foreground');

    await fireEvent.click(row);

    const input = screen.getByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('commits typed inline input on Enter and dispatches proposalapply with the edited value', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Workspace title' }]),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    await fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Updated workspace' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail.editedFields.title).toBe('Updated workspace');
  });

  it('reverts displayed value on Escape and does not change fieldValues', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'title', label: 'Title', value: 'Original title' }]),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    await fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Changed title' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(screen.getByText('Original title')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(event?.detail.editedFields.title).toBe('Original title');
  });

  it('does not focus or edit non-editable fields', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([
          { key: 'repositoryPath', label: 'Repository path', value: '/repo/x', editable: false },
        ]),
      },
    });

    const field = container.querySelector('[data-proposal-field="repositoryPath"]') as HTMLElement;

    expect(field.getAttribute('tabindex')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Repository path' })).toBeNull();

    await fireEvent.click(field);

    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders a custom applyLabel for Layout B proposals and falls back to Apply', () => {
    const { unmount } = render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'defaultModel', label: 'Default model', value: 'sonnet' }], {
          applyLabel: 'Save changes',
        }),
      },
    });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save changes' }).getAttribute('aria-keyshortcuts'),
    ).toBe('Enter');

    unmount();

    render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'defaultModel', label: 'Default model', value: 'opus' }]),
      },
    });

    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('keeps Layout A button copy hardcoded even when applyLabel is set', () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({ applyLabel: 'Archive' }),
      },
    });

    expect(screen.getByRole('button', { name: /Create workspace/ })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Create workspace/ }).getAttribute('aria-keyshortcuts'),
    ).toBe('Enter');
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('renders Layout A Discard with the same Button styling as Layout B', () => {
    const { unmount } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(),
      },
    });
    const workspaceDiscard = screen.getByRole('button', { name: 'Discard' });
    const workspaceDiscardClass = workspaceDiscard.className;

    unmount();

    render(ProposalCard, {
      props: {
        proposal: makeProposal([{ key: 'defaultModel', label: 'Default model', value: 'opus' }]),
      },
    });

    expect(workspaceDiscard.getAttribute('data-slot')).toBe('button');
    expect(workspaceDiscardClass).toBe(screen.getByRole('button', { name: 'Discard' }).className);
  });

  it('renders workspace metadata controls with the shared label and control row structure', () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'main',
            specialist: 'spec-writer',
          },
        }),
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-row="metadata"]'));

    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => row.querySelector('[data-metadata-label]')?.textContent?.trim()),
    ).toEqual(['Repo', 'Base branch', 'Specialist']);
    for (const row of rows) {
      expect(row.className).toContain('grid-cols-[6rem_minmax(0,1fr)]');
      expect(row.querySelector('[data-metadata-label]')?.className).toContain(
        'text-muted-foreground',
      );
      expect(row.getAttribute('role')).toBe('group');
      expect(row.getAttribute('aria-labelledby')).toBeTruthy();
    }
    expect(screen.getByTestId('proposal-repo-picker').closest('[data-row="metadata"]')).toBe(
      rows[0],
    );
    expect(screen.getByTestId('proposal-branch-picker').closest('[data-row="metadata"]')).toBe(
      rows[1],
    );
    expect(screen.getByTestId('proposal-specialist-dropdown')).toBe(rows[2]);
    const pickerMocks = screen.getAllByTestId('mock-repo-and-branch-picker');
    expect(pickerMocks.map((picker) => picker.getAttribute('data-field'))).toEqual([
      'repo',
      'branch',
    ]);
    expect(pickerMocks.map((picker) => picker.getAttribute('data-presentation'))).toEqual([
      'metadata',
      'metadata',
    ]);
    expect(screen.getByTestId('mock-specialist-dropdown').getAttribute('data-variant')).toBe(
      'bare',
    );
  });

  it('renders Layout B before and after values in one row with an arrow between them', () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeProposal([
          {
            key: 'defaultModel',
            label: 'Default model',
            before: 'claude-3-5-sonnet-latest',
            after: 'claude-sonnet-4-20250514',
          },
        ]),
      },
    });

    const row = container.querySelector(
      '[data-proposal-before-after-row="defaultModel"]',
    ) as HTMLElement;
    const text = row.textContent ?? '';

    expect(row).toBeTruthy();
    expect(row.className).not.toContain('grid');
    expect(text.indexOf('claude-3-5-sonnet-latest')).toBeLessThan(text.indexOf('→'));
    expect(text.indexOf('→')).toBeLessThan(text.indexOf('claude-sonnet-4-20250514'));
  });

  it('routes specialist-edit proposals to the specialist change card', () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeSpecialistProposal(),
      },
    });

    expect(screen.getByText('Edit specialist: Review Buddy')).toBeTruthy();
    expect(container.textContent).toContain('Name: Reviewer → Review Buddy');
    expect(container.textContent).not.toContain('specialist edit');
  });

  // Undo reachability (intent-hq/intent#3965): an applied proposal routed
  // through ProposalCard must surface the Undo affordance from its history
  // entry and forward onUndo with the proposal id.
  it('offers Undo on an applied specialist proposal and forwards onUndo', async () => {
    historySelectorState.specialistApplied = { appliedAt: Date.now(), reverse: {} };
    const proposal = { ...makeSpecialistProposal(), applyToolCallId: 'tool-specialist-edit' };
    const onUndo = vi.fn();
    render(ProposalCard, { props: { proposal, onUndo } });

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledWith('tool-specialist-edit');
  });

  it('offers Undo on an applied settings proposal and forwards onUndo', async () => {
    historySelectorState.settingsApplied = { appliedAt: Date.now(), reverseChanges: [] };
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings-change',
      payload: { changes: [{ path: 'theme.activePresetId', value: 'dracula' }] },
      preview: { title: 'Theme preset: Dracula' },
    };
    const onUndo = vi.fn();
    render(ProposalCard, { props: { proposal, onUndo } });

    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledWith('tool-settings-change');
  });

  it('renders workspace initialPrompt as an always-visible textarea and applies typed edits', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: '',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'main',
            specialist: 'spec-writer',
          },
        }),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    const prompt = screen.getByPlaceholderText(
      'What would you like to work on?',
    ) as HTMLTextAreaElement;
    expect(prompt).toBeTruthy();
    expect(screen.getByTestId('proposal-repo-picker')).toBeTruthy();
    expect(screen.getByTestId('proposal-branch-picker')).toBeTruthy();
    expect(screen.getByTestId('proposal-specialist-dropdown')).toBeTruthy();
    expect(screen.queryByText('Initial prompt')).toBeNull();
    expect(screen.queryByText('Title:')).toBeNull();
    expect(screen.queryByText('Status message:')).toBeNull();

    await fireEvent.input(prompt, { target: { value: 'Review and summarize PR #647' } });
    await fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));

    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail.editedFields.initialPrompt).toBe('Review and summarize PR #647');
    expect(event?.detail.editedFields.repoPath).toBe('/repo/x');
    expect(event?.detail.editedFields.branch).toBe('main');
    expect(event?.detail.editedFields.specialist).toBe('spec-writer');
  });

  it('renders Chief-style workspace-create params without hydrated preview fields', () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            repository: 'example-org/example-repo',
            initialMessage: 'Review and summarize PR #647',
            specialist: 'implementor',
          },
        ),
      },
    });

    const prompt = screen.getByPlaceholderText(
      'What would you like to work on?',
    ) as HTMLTextAreaElement;
    const [repoPicker, branchPicker] = screen.getAllByTestId('mock-repo-and-branch-picker');

    expect(prompt.value).toBe('Review and summarize PR #647');
    expect(repoPicker.textContent).toContain('github');
    expect(repoPicker.textContent).toContain('https://github.com/example-org/example-repo');
    expect(branchPicker.textContent).toContain('main');
    expect(screen.getByTestId('mock-specialist-dropdown').textContent).toContain('implementor');
  });

  it('hydrates exact Chief workspace-create PR payload from params when preview fields are missing', () => {
    render(ProposalCard, {
      props: {
        proposal: {
          kind: 'workspace-create',
          payload: {
            operation: 'workspace.create',
            params: {
              prUrl: 'https://github.com/example-org/example-repo/pull/648',
              repositoryName: 'example-repo',
              repositoryOwner: 'example-org',
              specialist: 'pr-reviewer',
              initialMessage: 'Review PR #648 ...',
            },
          },
          preview: {
            title: 'Create workspace: Review PR #648',
          },
        },
      },
    });

    const [repoPicker, branchPicker] = screen.getAllByTestId('mock-repo-and-branch-picker');
    const repoRow = screen.getByTestId('proposal-repo-picker');

    expect(repoRow.textContent).toContain('example-org/example-repo');
    expect(repoPicker.textContent).toContain('github');
    expect(branchPicker.textContent).toContain('main');
    expect(screen.queryByText('Select a repository')).toBeNull();
    expect(screen.getByTestId('mock-specialist-dropdown').textContent).toContain('pr-reviewer');
  });

  it('performs the PR source branch lookup via IPC and displays the result', async () => {
    setElectronEnv();
    electronBridgeMocks.invoke.mockResolvedValue({
      success: true,
      data: { sourceBranch: 'install-local-package' },
    });

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            initialMessage: 'Review PR #648',
          },
        ),
      },
    });

    const request = { owner: 'example-org', repo: 'example-repo', prNumber: 648 };
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    const startedAction = prBranchLookupStarted(payload);
    await waitFor(() => expect(prBranchLookupState.dispatch).toHaveBeenCalledWith(startedAction));
    await waitFor(() =>
      expect(electronBridgeMocks.invoke).toHaveBeenCalledWith('git-tracking:get-pull-request', {
        owner: 'example-org',
        repo: 'example-repo',
        number: 648,
      }),
    );

    prBranchLookupState.lookupEntries[payload.key] = {
      status: 'succeeded',
      branch: 'install-local-package',
    };
    prBranchLookupState.emit();

    await waitFor(() => expect(getBranchPicker().textContent).toContain('install-local-package'));
  });

  it('prevents creating a PR workspace until branch detection finishes', async () => {
    setElectronEnv();
    const lookup = deferred<{ success: boolean; data: { sourceBranch: string } }>();
    electronBridgeMocks.invoke.mockReturnValue(lookup.promise);
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            initialMessage: 'Review PR #648',
          },
        ),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    const request = { owner: 'example-org', repo: 'example-repo', prNumber: 648 };
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    await waitFor(() =>
      expect(prBranchLookupState.dispatch).toHaveBeenCalledWith(prBranchLookupStarted(payload)),
    );

    const button = await screen.findByRole('button', { name: /Detecting branch/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Detecting PR branch…');

    await fireEvent.click(button);
    expect(applyListener).not.toHaveBeenCalled();

    lookup.resolve({ success: true, data: { sourceBranch: 'install-local-package' } });
    prBranchLookupState.lookupEntries[payload.key] = {
      status: 'succeeded',
      branch: 'install-local-package',
    };
    prBranchLookupState.emit();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create workspace/ })).toBeTruthy(),
    );
  });

  it('does not overwrite a user-edited branch when the PR branch lookup resolves late', async () => {
    setElectronEnv();
    const lookup = deferred<{ success: boolean; data: { sourceBranch: string } }>();
    electronBridgeMocks.invoke.mockReturnValue(lookup.promise);

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            initialMessage: 'Review PR #648',
          },
        ),
      },
    });

    const request = { owner: 'example-org', repo: 'example-repo', prNumber: 648 };
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    await waitFor(() =>
      expect(prBranchLookupState.dispatch).toHaveBeenCalledWith(prBranchLookupStarted(payload)),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Mock branch change' }));

    lookup.resolve({ success: true, data: { sourceBranch: 'install-local-package' } });
    prBranchLookupState.lookupEntries[payload.key] = {
      status: 'succeeded',
      branch: 'install-local-package',
    };
    prBranchLookupState.emit();
    await flushAsyncWork();

    expect(getBranchPicker().textContent).toContain('mock-branch');
    expect(getBranchPicker().textContent).not.toContain('install-local-package');
  });

  it('does not fetch a PR branch when no PR URL is available', async () => {
    setElectronEnv();

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({}, { repository: 'example-org/example-repo' }),
      },
    });

    await flushAsyncWork();

    expect(electronBridgeMocks.invoke).not.toHaveBeenCalled();
    expect(prBranchLookupState.dispatch).not.toHaveBeenCalled();
  });

  it('does not fetch a PR branch when an explicit branch is already provided', async () => {
    setElectronEnv();

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            branch: 'feature/foo',
          },
        ),
      },
    });

    await flushAsyncWork();

    expect(electronBridgeMocks.invoke).not.toHaveBeenCalled();
    expect(prBranchLookupState.dispatch).not.toHaveBeenCalled();
    expect(getBranchPicker().textContent).toContain('feature/foo');
  });

  it('keeps the fallback branch without errors when electronAPI is unavailable', async () => {
    clearElectronAPI();

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
          },
        ),
      },
    });

    await flushAsyncWork();

    expect(getBranchPicker().textContent).toContain('main');
    expect(prBranchLookupState.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Create workspace/ }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('renders a subtle branch fallback hint when the PR branch lookup fails', async () => {
    setElectronEnv();
    electronBridgeMocks.invoke.mockResolvedValue({ success: false, error: 'rate limited' });

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            initialMessage: 'Review PR #648',
          },
        ),
      },
    });

    const request = { owner: 'example-org', repo: 'example-repo', prNumber: 648 };
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    await waitFor(() =>
      expect(prBranchLookupState.dispatch).toHaveBeenCalledWith(prBranchLookupStarted(payload)),
    );

    prBranchLookupState.lookupEntries[payload.key] = {
      status: 'failed',
      error: 'rate limited',
    };
    prBranchLookupState.emit();

    expect((await screen.findByTestId('proposal-branch-lookup-failure')).textContent).toContain(
      "Couldn't auto-detect base branch; using default",
    );
  });

  it('emits workspace picker changes on Apply instead of rendering title/status chips', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Start here',
            repoPath: '/repo/original',
            branch: 'main',
            specialist: 'spec-writer',
          },
        }),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    expect(screen.getAllByTestId('mock-repo-and-branch-picker')).toHaveLength(2);
    expect(screen.getByTestId('mock-specialist-dropdown')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
    expect(screen.queryByText('Status message:')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Mock repo change' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Mock branch change' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Mock specialist change' }));
    await fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));

    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail.editedFields.repoPath).toBe('/repo/mock');
    expect(event?.detail.editedFields.branch).toBe('mock-branch');
    expect(event?.detail.editedFields.scope).toBe('src');
    expect(event?.detail.editedFields.specialist).toBe('ui-designer');
  });

  it('renders sibling mode with editable allowed fields and locked repository metadata', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Investigate follow-up',
            initialPrompt: 'Inspect the separate issue.',
            repoPath: '/repo/current',
            repoType: 'local',
            branch: 'feature/dependency',
            specialist: 'planner',
          },
        }),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    const title = screen.getByTestId('proposal-workspace-title') as HTMLInputElement;
    const prompt = screen.getByPlaceholderText('What would you like to work on?');
    expect(title.value).toBe('Investigate follow-up');
    expect(screen.getByTestId('proposal-repo-locked').textContent).toContain('/repo/current');
    expect(screen.queryByTestId('proposal-repo-picker')).toBeNull();
    expect(screen.getByTestId('proposal-branch-picker')).toBeTruthy();

    await fireEvent.input(title, { target: { value: 'Edited follow-up' } });
    await fireEvent.input(prompt, { target: { value: 'Use the findings from this workspace.' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Mock branch change' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Mock specialist change' }));
    await fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));

    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail.editedFields).toEqual({
      title: 'Edited follow-up',
      initialPrompt: 'Use the findings from this workspace.',
      branch: 'mock-branch',
      specialist: 'ui-designer',
    });
  });

  it('renders the localized sibling heading without changing the Chief heading', () => {
    const { unmount } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Investigate follow-up',
            repoPath: '/repo/current',
          },
        }),
      },
    });

    expect(screen.getByRole('heading', { name: 'Create new workspace' })).toBeTruthy();
    unmount();

    render(ProposalCard, { props: { proposal: makeWorkspaceProposal() } });
    expect(screen.getByRole('heading', { name: 'Create workspace: Review PR #647' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create new workspace' })).toBeNull();
  });

  it('matches the locked sibling Repo field to the Base branch soft filled surface', () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Investigate follow-up',
            repoPath: '/repo/current',
            branch: 'main',
          },
        }),
      },
    });

    const repoClasses = screen.getByTestId('proposal-repo-locked').className.split(/\s+/);
    expect(repoClasses).toEqual(
      expect.arrayContaining([
        'rounded-md',
        'bg-muted/40',
        'px-2',
        'py-1',
        'text-sm',
        'leading-5',
        'font-normal',
        'text-foreground',
      ]),
    );
    expect(repoClasses).not.toContain('border');
    expect(getBranchPicker().getAttribute('data-presentation')).toBe('metadata');
  });

  it('shows the sibling shortcut hint only while a title or prompt editor has focus', async () => {
    const { unmount } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Investigate follow-up',
            initialPrompt: 'Inspect the separate issue.',
            repoPath: '/repo/current',
          },
        }),
      },
    });
    const title = screen.getByTestId('proposal-workspace-title');
    const prompt = screen.getByPlaceholderText('What would you like to work on?');
    const createButton = screen.getByRole('button', { name: /Create workspace/ });
    const shortcutHint = () => screen.queryByText(/^(?:⌘|Ctrl)\+↵$/);

    expect(shortcutHint()).toBeNull();
    await fireEvent.focus(title);
    expect(shortcutHint()).toBeTruthy();

    await fireEvent.blur(title, { relatedTarget: prompt });
    expect(shortcutHint()).toBeTruthy();
    await fireEvent.focus(prompt);
    expect(shortcutHint()).toBeTruthy();

    await fireEvent.blur(prompt, { relatedTarget: createButton });
    await fireEvent.focus(createButton);
    expect(shortcutHint()).toBeNull();
    unmount();

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Disabled follow-up',
            repoPath: '/repo/current',
          },
        }),
        disabled: true,
      },
    });
    await fireEvent.focus(screen.getByTestId('proposal-workspace-title'));
    expect(shortcutHint()).toBeNull();
  });

  it('keeps Ctrl+Enter workspace submission from the focused sibling prompt', async () => {
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Investigate follow-up',
            initialPrompt: 'Inspect the separate issue.',
            repoPath: '/repo/current',
          },
        }),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);
    const prompt = screen.getByPlaceholderText('What would you like to work on?');

    await fireEvent.focus(prompt);
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(applyListener).not.toHaveBeenCalled();

    await fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    expect(applyListener).toHaveBeenCalledTimes(1);
  });

  it('discards sibling mode without applying workspace creation', async () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Separate follow-up',
            repoPath: '/repo/current',
          },
        }),
        onApply,
        onDiscard,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Discarded:/)).toBeTruthy();
  });

  it('uses workspace-specific wording for workspace-create while applying', () => {
    lifecycleSelectorState.status = 'applying';
    const { container } = render(ProposalCard, {
      props: { proposal: makeWorkspaceProposal() },
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Creating workspace…');
    expect(status?.textContent).not.toMatch(/proposal/i);
  });

  it('uses workspace-specific wording for workspace-create when it fails', () => {
    lifecycleSelectorState.status = 'failed';
    lifecycleSelectorState.error = 'Branch already exists';
    const { container } = render(ProposalCard, {
      props: { proposal: makeWorkspaceProposal() },
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Workspace creation failed: Branch already exists');
    expect(status?.textContent).not.toMatch(/proposal/i);
    expect(container.textContent).not.toMatch(/Action failed/i);
  });

  it('renders an Open workspace link instead of any proposal status text after successful create', async () => {
    lifecycleSelectorState.status = 'applied';
    lifecycleSelectorState.result = { workspaceId: 'ws-new' };
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            mode: 'sibling',
            title: 'Sibling follow-up',
            repoPath: '/repo/current',
          },
        }),
      },
    });

    const link = screen.getByTestId('proposal-open-created-workspace');
    expect(link.getAttribute('href')).toBe('/workspace/ws-new');
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeTruthy();

    // No generic applied status line, and no lingering Create workspace button.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create workspace/ })).toBeNull();
    expect(screen.queryByText(/proposal/i)).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(navigationMocks.goto).toHaveBeenCalledWith('/workspace/ws-new');
  });

  it('renders the created workspace summary as non-editable (no form controls, no Discard button)', () => {
    lifecycleSelectorState.status = 'applied';
    lifecycleSelectorState.result = { workspaceId: 'ws-new' };
    const { container } = render(ProposalCard, {
      props: { proposal: makeWorkspaceProposal() },
    });

    // The done summary must replace the editable form entirely.
    expect(container.querySelector('[data-state="workspace-created"]')).not.toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByTestId('proposal-repo-picker')).toBeNull();
    expect(screen.queryByTestId('proposal-branch-picker')).toBeNull();
    expect(screen.queryByTestId('proposal-specialist-dropdown')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Applying/ })).toBeNull();
  });

  it('falls back to a neutral "Workspace created." note when no workspaceId is available', () => {
    lifecycleSelectorState.status = 'applied';
    lifecycleSelectorState.result = null;
    render(ProposalCard, {
      props: { proposal: makeWorkspaceProposal() },
    });

    expect(screen.getByTestId('proposal-workspace-created').textContent).toBe('Workspace created.');
    expect(screen.queryByTestId('proposal-open-created-workspace')).toBeNull();
    expect(screen.queryByText(/proposal/i)).toBeNull();
  });

  it('warns and preselects the default branch when the proposed base branch is missing, without blocking apply', async () => {
    // The mock picker reports branches [main, develop] + remote [release/1.0], default 'main'.
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'feature/does-not-exist',
          },
        }),
      },
    });
    const applyListener = vi.fn();
    container
      .querySelector('[data-proposal-kind]')
      ?.addEventListener('proposalapply', applyListener as EventListener);

    await fireEvent.click(screen.getByRole('button', { name: 'Mock branches loaded' }));

    // Warning keeps the proposed value visible and names the default fallback.
    const warning = screen.getByTestId('proposal-branch-mismatch-warning');
    expect(warning.textContent).toContain('feature/does-not-exist');
    expect(warning.textContent).toContain("'main'");
    // The picker was preselected to the default branch.
    expect(getBranchPicker().textContent).toContain('main');
    // The branch row is visually flagged.
    expect(screen.getByTestId('proposal-branch-picker').getAttribute('data-branch-warning')).toBe(
      'true',
    );

    // Apply is never blocked: Create workspace stays enabled and sends the default branch.
    const createButton = screen.getByRole('button', { name: /Create workspace/ });
    expect(createButton.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(createButton);
    const event = applyListener.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.detail.editedFields.branch).toBe('main');
  });

  it('does not warn when the proposed base branch exists locally or remotely', async () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'release/1.0',
          },
        }),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mock branches loaded' }));

    expect(screen.queryByTestId('proposal-branch-mismatch-warning')).toBeNull();
    expect(
      screen.getByTestId('proposal-branch-picker').getAttribute('data-branch-warning'),
    ).toBeNull();
    expect(getBranchPicker().textContent).toContain('release/1.0');
  });

  it('clears the missing-branch warning when the repository changes', async () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'feature/does-not-exist',
          },
        }),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mock branches loaded' }));
    expect(screen.getByTestId('proposal-branch-mismatch-warning')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Mock repo change' }));
    expect(screen.queryByTestId('proposal-branch-mismatch-warning')).toBeNull();
    expect(
      screen.getByTestId('proposal-branch-picker').getAttribute('data-branch-warning'),
    ).toBeNull();
  });

  it('clears the missing-branch warning once the user picks a branch', async () => {
    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'feature/does-not-exist',
          },
        }),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mock branches loaded' }));
    expect(screen.getByTestId('proposal-branch-mismatch-warning')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Mock branch change' }));
    expect(screen.queryByTestId('proposal-branch-mismatch-warning')).toBeNull();
  });

  it('directs the user to the Base branch field on a structured base-ref-unresolvable failure', async () => {
    // Primary detection path (monorepo#761): the daemon's structured
    // error.data.code, threaded into the lifecycle slice as errorCode. The
    // error prose deliberately does NOT match the legacy regex to prove the
    // code alone triggers the affordance.
    lifecycleSelectorState.status = 'failed';
    lifecycleSelectorState.error = 'Invalid params';
    lifecycleSelectorState.errorCode = 'base-ref-unresolvable';
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'nonexistent-branch',
          },
        }),
      },
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Workspace creation failed');
    expect(status?.textContent).toContain('Choose a different base branch above, then retry.');

    const branchRow = screen.getByTestId('proposal-branch-picker');
    expect(branchRow.getAttribute('data-branch-warning')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(branchRow));
  });

  it('directs the user to the Base branch field on a cannot-resolve-base-ref prose failure (older daemons)', async () => {
    // Fallback detection path: daemons that predate the structured code only
    // send the "cannot resolve base ref '<ref>'" prose, with no errorCode.
    lifecycleSelectorState.status = 'failed';
    lifecycleSelectorState.error = "cannot resolve base ref 'nonexistent-branch'";
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'nonexistent-branch',
          },
        }),
      },
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Workspace creation failed');
    expect(status?.textContent).toContain('Choose a different base branch above, then retry.');

    // The Base branch row is highlighted and receives focus instead of the status line.
    const branchRow = screen.getByTestId('proposal-branch-picker');
    expect(branchRow.getAttribute('data-branch-warning')).toBe('true');
    // The focus target carries an accessible name so screen readers announce it.
    expect(branchRow.getAttribute('role')).toBe('group');
    expect(branchRow.getAttribute('aria-label')).toBe('Base branch');
    await waitFor(() => expect(document.activeElement).toBe(branchRow));
  });

  it('associates the mismatch warning with the branch row and clears it when a PR branch lookup resolves', async () => {
    setElectronEnv();
    electronBridgeMocks.invoke.mockResolvedValue({
      success: true,
      data: { sourceBranch: 'pr-head-branch' },
    });

    render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal(
          {},
          {
            prUrl: 'https://github.com/example-org/example-repo/pull/648',
            initialMessage: 'Review PR #648',
            branch: 'feature/does-not-exist',
          },
        ),
      },
    });

    // The missing proposed branch is preselected to the default ('main').
    await fireEvent.click(screen.getByRole('button', { name: 'Mock branches loaded' }));
    const warning = screen.getByTestId('proposal-branch-mismatch-warning');
    const branchRow = screen.getByTestId('proposal-branch-picker');
    expect(branchRow.getAttribute('aria-describedby')).toBe(warning.getAttribute('id'));
    expect(warning.getAttribute('id')).toBeTruthy();

    // Preselecting 'main' arms the PR-branch lookup; once it resolves, the
    // PR head branch replaces the default and the stale warning is cleared.
    const request = { owner: 'example-org', repo: 'example-repo', prNumber: 648 };
    const payload = { ...request, key: getPrBranchLookupKey(request) };
    await waitFor(() =>
      expect(prBranchLookupState.dispatch).toHaveBeenCalledWith(prBranchLookupStarted(payload)),
    );
    prBranchLookupState.lookupEntries[payload.key] = {
      status: 'succeeded',
      branch: 'pr-head-branch',
    };
    prBranchLookupState.emit();
    await flushAsyncWork();

    expect(getBranchPicker().textContent).toContain('pr-head-branch');
    expect(screen.queryByTestId('proposal-branch-mismatch-warning')).toBeNull();
  });

  it('keeps generic workspace-create failures on the status line without a branch affordance', () => {
    lifecycleSelectorState.status = 'failed';
    lifecycleSelectorState.error = 'daemon unavailable';
    const { container } = render(ProposalCard, {
      props: {
        proposal: makeWorkspaceProposal({
          workspaceCreate: {
            initialPrompt: 'Fix the bug',
            repoPath: '/repo/x',
            repoType: 'local',
            branch: 'main',
          },
        }),
      },
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Workspace creation failed: daemon unavailable');
    expect(status?.textContent).not.toContain('Choose a different base branch');
    expect(
      screen.getByTestId('proposal-branch-picker').getAttribute('data-branch-warning'),
    ).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

const { dispatch, selectorState } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  selectorState: {
    showDeleteWarning: false,
    runningAgentNamesForDelete: [] as string[],
    activeHookNamesForDelete: [] as string[],
    openPrsForDelete: [] as unknown[],
    localChangesForDelete: null,
    showArchiveWarning: false,
    runningAgentNamesForArchive: [] as string[],
    activeHookNamesForArchive: [] as string[],
    openPrsForArchive: [] as unknown[],
    localChangesForArchive: null,
    showBulkArchiveConfirm: false,
    showBulkDeleteConfirm: false,
    pendingBulkWorkspaceIds: [] as string[],
    pendingBulkWorkspaces: [] as unknown[],
    pendingBulkGroupLabel: null as string | null,
    bulkActiveAgentCount: 0,
    bulkActiveHookCount: 0,
  },
}));

vi.mock('$store/renderer/store', () => ({ store: { dispatch } }));
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../../layout/__tests__/mocks/MockWorkspaceHoverCard.svelte')).default,
}));
vi.mock('$store/renderer/slices/workspace-operations/workspace-operations-selectors', () => {
  const selector = (key: keyof typeof selectorState) => () => ({
    subscribe: (run: (value: unknown) => void) => {
      run(selectorState[key]);
      return () => {};
    },
  });
  return {
    selectShowDeleteWarning: selector('showDeleteWarning'),
    selectRunningAgentNamesForDelete: selector('runningAgentNamesForDelete'),
    selectActiveHookNamesForDelete: selector('activeHookNamesForDelete'),
    selectOpenPrsForDelete: selector('openPrsForDelete'),
    selectLocalChangesForDelete: selector('localChangesForDelete'),
    selectShowArchiveWarning: selector('showArchiveWarning'),
    selectRunningAgentNamesForArchive: selector('runningAgentNamesForArchive'),
    selectActiveHookNamesForArchive: selector('activeHookNamesForArchive'),
    selectOpenPrsForArchive: selector('openPrsForArchive'),
    selectLocalChangesForArchive: selector('localChangesForArchive'),
    selectShowBulkArchiveConfirm: selector('showBulkArchiveConfirm'),
    selectShowBulkDeleteConfirm: selector('showBulkDeleteConfirm'),
    selectPendingBulkWorkspaceIds: selector('pendingBulkWorkspaceIds'),
    selectPendingBulkWorkspaces: selector('pendingBulkWorkspaces'),
    selectPendingBulkGroupLabel: selector('pendingBulkGroupLabel'),
    selectBulkActiveAgentCount: selector('bulkActiveAgentCount'),
    selectBulkActiveHookCount: selector('bulkActiveHookCount'),
  };
});

warmImport(() => import('../WorkspaceWarningDialogs.svelte'));

describe('WorkspaceWarningDialogs bulk confirmations', () => {
  beforeEach(() => {
    dispatch.mockClear();
    selectorState.showBulkArchiveConfirm = false;
    selectorState.showBulkDeleteConfirm = false;
    selectorState.pendingBulkWorkspaceIds = [];
    selectorState.pendingBulkWorkspaces = [];
    selectorState.pendingBulkGroupLabel = null;
  });
  afterEach(cleanup);

  it('renders the pending archive count and dispatches the confirm action', async () => {
    selectorState.showBulkArchiveConfirm = true;
    selectorState.pendingBulkWorkspaceIds = ['ws-1', 'ws-2'];
    selectorState.pendingBulkWorkspaces = [
      { id: 'ws-1', title: 'First workspace', branch: 'main', status: 'Active' },
      { id: 'ws-2', title: 'Second workspace', branch: 'feature/two', status: 'Active' },
    ];
    selectorState.pendingBulkGroupLabel = 'Idle';
    const WorkspaceWarningDialogs = (await import('../WorkspaceWarningDialogs.svelte')).default;

    render(WorkspaceWarningDialogs);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^2 /)).toBeTruthy();
    expect(within(dialog).getByText('First workspace')).toBeTruthy();
    expect(within(dialog).getByText('Second workspace')).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Archive all' }));
    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'workspaceOperations/confirmBulkArchive',
      ),
    ).toBe(true);
  });

  it('renders the pending delete count and dispatches the confirm action', async () => {
    selectorState.showBulkDeleteConfirm = true;
    selectorState.pendingBulkWorkspaceIds = ['ws-1', 'ws-2', 'ws-3'];
    selectorState.pendingBulkWorkspaces = [
      { id: 'ws-1', title: 'First workspace', branch: 'main', status: 'Active' },
      { id: 'ws-2', title: 'Second workspace', branch: 'feature/two', status: 'Active' },
      { id: 'ws-3', title: 'Third workspace', branch: 'old', status: 'Archived' },
    ];
    selectorState.pendingBulkGroupLabel = 'Completed';
    const WorkspaceWarningDialogs = (await import('../WorkspaceWarningDialogs.svelte')).default;

    render(WorkspaceWarningDialogs);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^3 /)).toBeTruthy();
    expect(within(dialog).getByText('First workspace')).toBeTruthy();
    expect(within(dialog).getByText('Second workspace')).toBeTruthy();
    expect(within(dialog).getByText('Third workspace')).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete all' }));
    expect(
      dispatch.mock.calls.some(
        ([action]) => action.type === 'workspaceOperations/confirmBulkDelete',
      ),
    ).toBe(true);
  });
});

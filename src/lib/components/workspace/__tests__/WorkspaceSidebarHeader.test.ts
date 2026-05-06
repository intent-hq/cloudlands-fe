/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const update = vi.fn();
  const selector = <T>(value: T) =>
    Object.assign(
      () => ({
        subscribe(run: (v: T) => void) {
          run(value);
          return () => {};
        },
      }),
      { select: () => value },
    );
  return { dispatch, update, selector };
});

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
  getStoreContext: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: mocks.dispatch }),
}));

vi.mock('$lib/store/slices/ui-layout/ui-layout-selectors', () => ({
  selectSidebarSide: mocks.selector('left'),
}));

vi.mock('$lib/store/slices/ui-layout/ui-layout-slice', () => ({
  toggleSidebarSide: vi.fn(() => ({ type: 'uiLayout/toggleSidebarSide' })),
}));

vi.mock('$lib/store/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((workspace: Workspace) => ({
    type: 'workspace/setWorkspaceEntity',
    payload: [workspace],
  })),
}));

vi.mock('$lib/store/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));

vi.mock('$lib/store/slices/workspace-operations/workspace-operations-slice', () => ({
  requestDeleteWorkspace: vi.fn((id: string) => ({
    type: 'workspaceOperations/delete',
    payload: [id],
  })),
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/utils/delete-warning-utils', () => ({
  hasRunningAgents: vi.fn(() => false),
  getRunningAgentNames: vi.fn(() => []),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateAfterWorkspaceRemoval: vi.fn(() => Promise.resolve()),
}));

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/ui/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/modals/DeleteWarningDialog.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/icons/GitBranchIcon.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const baseWorkspace = {
  id: 'ws-1',
  title: 'Status Workspace',
  branch: 'feature/status',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  createdAt: '2026-05-05T00:00:00.000Z',
  updatedAt: '2026-05-05T00:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
} as Workspace;

async function renderHeader(overrides: Partial<Workspace> = {}) {
  const WorkspaceSidebarHeader = (await import('../WorkspaceSidebarHeader.svelte')).default;
  const workspace = { ...baseWorkspace, ...overrides } as Workspace;
  return render(WorkspaceSidebarHeader, { props: { workspace, workspaceId: workspace.id } });
}

describe('WorkspaceSidebarHeader status message', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue({ ok: true, data: baseWorkspace });
  });

  it('renders the workspace status message under the title', async () => {
    await renderHeader({ statusMessage: 'Implementing Wave 2 UI.' });

    expect(screen.getByRole('button', { name: 'Status Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit workspace status' }).textContent).toContain(
      'Implementing Wave 2 UI.',
    );
  });

  it('shows a discoverable add status affordance when empty', async () => {
    await renderHeader({ statusMessage: undefined });

    expect(screen.getByRole('button', { name: 'Add workspace status' }).textContent).toContain(
      'Add status…',
    );
  });

  it('saves status edits on Enter and dispatches the updated workspace', async () => {
    const updatedWorkspace = { ...baseWorkspace, statusMessage: 'Ready for verification.' };
    mocks.update.mockResolvedValue({ ok: true, data: updatedWorkspace });

    await renderHeader({ statusMessage: '' });
    await fireEvent.click(screen.getByRole('button', { name: 'Add workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Ready for verification.' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        id: 'ws-1',
        statusMessage: 'Ready for verification.',
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
  });

  it('saves status edits on blur', async () => {
    const updatedWorkspace = { ...baseWorkspace, statusMessage: 'Reviewing final checks.' };
    mocks.update.mockResolvedValue({ ok: true, data: updatedWorkspace });

    await renderHeader({ statusMessage: 'Old status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Reviewing final checks.' } });
    await fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        id: 'ws-1',
        statusMessage: 'Reviewing final checks.',
      }),
    );
  });

  it('cancels status edits on Escape without saving', async () => {
    await renderHeader({ statusMessage: 'Keep the original status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Do not save this.' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByLabelText('Workspace status')).toBeNull());
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

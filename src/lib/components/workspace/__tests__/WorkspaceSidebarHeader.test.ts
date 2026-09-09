/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const storeState = {
    workspace: {
      pendingTitleMutations: {} as Record<string, { token: number }>,
    },
  };
  const dispatch = vi.fn((action: { type: string; payload?: unknown[] }) => {
    const [workspaceId, token] = action.payload ?? [];
    if (action.type === 'workspace/beginWorkspaceTitleMutation') {
      storeState.workspace.pendingTitleMutations[workspaceId as string] = {
        token: token as number,
      };
    } else if (
      action.type === 'workspace/completeWorkspaceTitleMutation' ||
      action.type === 'workspace/failWorkspaceTitleMutation'
    ) {
      delete storeState.workspace.pendingTitleMutations[workspaceId as string];
    }
    return action;
  });
  const update = vi.fn();
  const clipboardWrite = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
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
  return { dispatch, update, clipboardWrite, toastSuccess, toastError, selector, storeState };
});

vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => mocks.storeState,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectSidebarSide: mocks.selector('left'),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  toggleSidebar: vi.fn(() => ({ type: 'uiLayout/toggleSidebar' })),
  toggleSidebarSide: vi.fn(() => ({ type: 'uiLayout/toggleSidebarSide' })),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelColumnCount: mocks.selector(2),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  setPanelColumnCount: vi.fn((workspaceId: string, count: number) => ({
    type: 'panelLayout/setPanelColumnCount',
    payload: [workspaceId, count],
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  beginWorkspaceTitleMutation: vi.fn(
    (id: string, token: number, optimisticTitle: string, previousTitle: string) => ({
      type: 'workspace/beginWorkspaceTitleMutation',
      payload: [id, token, optimisticTitle, previousTitle],
    }),
  ),
  completeWorkspaceTitleMutation: vi.fn((id: string, token: number, workspace: Workspace) => ({
    type: 'workspace/completeWorkspaceTitleMutation',
    payload: [id, token, workspace],
  })),
  failWorkspaceTitleMutation: vi.fn((id: string, token: number) => ({
    type: 'workspace/failWorkspaceTitleMutation',
    payload: [id, token],
  })),
  setWorkspaceEntity: vi.fn((workspace: Workspace) => ({
    type: 'workspace/setWorkspaceEntity',
    payload: [workspace],
  })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));

vi.mock('$store/renderer/slices/workspace-operations/workspace-operations-slice', () => ({
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

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('../sidebar/__tests__/mocks/MockTooltipRich.svelte')).default,
}));

vi.mock('$features/workspace/components/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockWorkspaceActionsMenu.svelte')).default,
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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../terminal/__tests__/mocks/MockButton.svelte'));
warmImport(() => import('../sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../sidebar/__tests__/mocks/MockWorkspaceActionsMenu.svelte'));
warmImport(() => import('../sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceSidebarHeader.svelte'));

describe('WorkspaceSidebarHeader status message', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.update.mockResolvedValue({ ok: true, data: baseWorkspace });
    mocks.clipboardWrite.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.storeState.workspace.pendingTitleMutations = {};
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mocks.clipboardWrite },
      configurable: true,
    });
  });

  it('does not render the panel column control in the workspace title header', async () => {
    const { container } = await renderHeader();
    const controls = container.querySelector('[data-sidebar-header-controls]')!;
    const actionsTrigger = controls.querySelector('[data-workspace-actions-trigger]')!;

    expect(controls.querySelector('[data-panel-column-count-trigger]')).toBeNull();
    expect(actionsTrigger).toBeTruthy();
  });

  it('renders the workspace status message under the title', async () => {
    await renderHeader({ statusMessage: 'Implementing Wave 2 UI.' });

    expect(screen.getByRole('button', { name: 'Status Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit workspace status' }).textContent).toContain(
      'Implementing Wave 2 UI.',
    );
  });

  it('renders repository and branch together after the status level', async () => {
    await renderHeader({ statusMessage: 'Aligning the sidebar hierarchy.' });

    const status = screen.getByRole('button', { name: 'Edit workspace status' });
    const repository = screen.getByText('augment/intent');
    const branch = screen.getByRole('button', { name: 'feature/status' });

    expect(
      status.compareDocumentPosition(repository) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(repository.parentElement).toBe(branch.closest('[data-sidebar-workspace-metadata]'));
  });

  it('gives long repository and branch names independent truncation boundaries', async () => {
    const repositoryName = 'long-running-navigation-redesign-repository';
    const branchName = 'feature/simplify-workspace-navigation-and-sidebar-metadata';
    const { container } = await renderHeader({ repositoryName, branch: branchName });

    const metadata = container.querySelector('[data-sidebar-workspace-metadata]');
    const repository = container.querySelector('[data-sidebar-repository]');
    const branchMetadata = container.querySelector('[data-sidebar-branch-metadata]');
    const branch = screen.getByRole('button', { name: branchName });

    expect(metadata?.className).toContain('overflow-hidden');
    expect(metadata?.className).toContain('h-5');
    expect(repository?.className).toContain('max-w-[45%]');
    expect(repository?.className).toContain('truncate');
    expect(repository?.className).toContain('h-5');
    expect(repository?.getAttribute('title')).toBe(`augment/${repositoryName}`);
    expect(branchMetadata?.className).toContain('h-5');
    expect(branchMetadata?.className).toContain('items-center');
    expect(branch.className).toContain('h-5');
    expect(branch.className).toContain('min-w-0');
    expect(branch.className).toContain('flex-1');
    expect(container.querySelector('[data-sidebar-branch-hover-card]')?.textContent).toContain(
      branchName,
    );
  });

  it.each(['worktree', 'direct', 'cow', undefined] as const)(
    'shows compact branch context without a glyph or checkout mode for %s',
    async (checkoutMode) => {
      const { container } = await renderHeader({ baseRef: 'main', checkoutMode });
      const hoverCard = container.querySelector('[data-sidebar-branch-hover-card]');

      expect(container.querySelector('[data-sidebar-branch-icon]')).toBeNull();
      expect(hoverCard?.textContent).toContain('feature/status');
      expect(hoverCard?.textContent).toContain('Base main');
      expect(hoverCard?.textContent).not.toContain('Worktree');
      expect(hoverCard?.textContent).not.toContain('Direct');
      expect(hoverCard?.textContent).not.toContain('CoW');
      expect(hoverCard?.textContent).not.toContain('Click to rename');
    },
  );

  it('renames on click and copies the branch name on Shift-click', async () => {
    await renderHeader();
    await fireEvent.click(screen.getByRole('button', { name: 'feature/status' }));
    const branchInput = await screen.findByPlaceholderText('branch name');
    expect(branchInput).toBeTruthy();

    await fireEvent.keyDown(branchInput, { key: 'Escape' });
    const branchButton = await screen.findByRole('button', { name: 'feature/status' });
    await fireEvent.click(branchButton, { shiftKey: true });

    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledWith('feature/status'));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Branch name copied to clipboard');
    expect(screen.queryByPlaceholderText('branch name')).toBeNull();
  });

  it('updates the sidebar workspace title before the rename response resolves', async () => {
    let resolveUpdate!: (result: { ok: true; data: Workspace }) => void;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    await renderHeader();
    await fireEvent.click(screen.getByRole('button', { name: 'Status Workspace' }));
    const titleInput = screen.getByRole('textbox');
    await fireEvent.input(titleInput, { target: { value: 'Renamed immediately' } });
    await fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        id: 'ws-1',
        title: 'Renamed immediately',
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspace/beginWorkspaceTitleMutation',
      payload: ['ws-1', expect.any(Number), 'Renamed immediately', 'Status Workspace'],
    });
    expect(screen.queryByRole('textbox')).toBeNull();

    resolveUpdate({
      ok: true,
      data: { ...baseWorkspace, title: 'Renamed immediately' },
    });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'workspace/completeWorkspaceTitleMutation' }),
      ),
    );
  });

  it('surfaces a rejected workspace title rename without leaving the editor pending', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'Rename rejected' });
    await renderHeader();
    await fireEvent.click(screen.getByRole('button', { name: 'Status Workspace' }));
    const titleInput = screen.getByRole('textbox');
    await fireEvent.input(titleInput, { target: { value: 'Rejected title' } });
    await fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Rename rejected'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders the title editor full-width without JS auto-resize', async () => {
    await renderHeader();
    await fireEvent.click(screen.getByRole('button', { name: 'Status Workspace' }));
    const titleInput = screen.getByRole('textbox') as HTMLInputElement;

    expect(titleInput.className.split(/\s+/)).toContain('w-full');
    expect(titleInput.style.width).toBe('');

    await fireEvent.input(titleInput, { target: { value: 'A much longer workspace title' } });
    expect(titleInput.style.width).toBe('');
  });

  it('applies the sidebar title decoration classes in display and edit modes', async () => {
    await renderHeader();
    const titleButton = screen.getByRole('button', { name: 'Status Workspace' });
    const decoration = titleButton.parentElement?.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    );

    expect(decoration).toBeTruthy();
    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-1',
        '-inset-y-0.5',
        'border-transparent',
        'bg-transparent',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );

    await fireEvent.click(titleButton);

    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-2',
        '-inset-y-1.5',
        'border-ring/60',
        'bg-sidebar',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
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

    // Enter saves without inserting a newline.
    expect((input as HTMLTextAreaElement).value).toBe('Ready for verification.');
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

  it('renders the status editor as a wrapping textarea', async () => {
    await renderHeader({ statusMessage: 'Old status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    expect(input.tagName).toBe('TEXTAREA');
    expect(input.className).toContain('resize-none');
    expect(input.className).toContain('whitespace-pre-wrap');
  });

  it('does not save and allows a newline on Shift+Enter', async () => {
    await renderHeader({ statusMessage: 'First line.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = (await screen.findByLabelText('Workspace status')) as HTMLTextAreaElement;

    const notPrevented = await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // Shift+Enter is left to the textarea's default newline insertion.
    expect(notPrevented).toBe(true);
    await fireEvent.input(input, { target: { value: 'First line.\nSecond line.' } });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Workspace status')).toBeTruthy();
    expect(input.value).toBe('First line.\nSecond line.');
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

  it.each(['Enter', ' '])(
    'opens workspace actions with %s and restores focus on Escape',
    async (key) => {
      const { container } = await renderHeader();
      const trigger = screen.getByRole('button', { name: 'Workspace actions' });

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      trigger.focus();
      await fireEvent.keyDown(trigger, { key });
      const menu = await screen.findByRole('menu');

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(container.contains(menu)).toBe(false);
      await fireEvent.keyDown(menu, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    },
  );

  it('opens workspace actions on pointer click and dismisses outside', async () => {
    await renderHeader();
    const trigger = screen.getByRole('button', { name: 'Workspace actions' });

    await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(trigger, { detail: 1 });
    await screen.findByRole('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(document.body, {
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('offers Transfer for the loaded workspace and opens its transfer modal', async () => {
    await renderHeader();
    const trigger = screen.getByRole('button', { name: 'Workspace actions' });

    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const transfer = await screen.findByRole('button', { name: 'Transfer/Download…' });

    expect(transfer.getAttribute('data-icon-name')).toBe('right-left');
    await fireEvent.click(transfer);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceTransfer/openModal',
      payload: [{ workspaceId: 'ws-1', workspaceTitle: 'Status Workspace' }],
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('does not offer Transfer while workspace data is unavailable', async () => {
    const WorkspaceSidebarHeader = (await import('../WorkspaceSidebarHeader.svelte')).default;
    render(WorkspaceSidebarHeader, { props: { workspace: null, workspaceId: 'ws-1' } });

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Workspace actions' }), {
      key: 'Enter',
    });
    await screen.findByRole('menu');

    expect(screen.queryByRole('button', { name: 'Transfer/Download…' })).toBeNull();
  });
});

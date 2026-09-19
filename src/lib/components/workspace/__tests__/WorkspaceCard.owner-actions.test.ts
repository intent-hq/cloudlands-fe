/**
 * @vitest-environment jsdom
 *
 * WorkspaceCard context-menu owner gating (multiplayer w4).
 *
 * The daemon refuses Transfer/Download, Archive and Delete for a collaborator
 * (`require_owner` → -32003), so a collaborator row's right-click menu omits
 * them — and opens no menu at all when nothing else remains — while an owner
 * row keeps the full menu. No Leave entry is added (leaving lives in Settings).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { createTestWorkspaceId } from '../../../../test/factories/workspace.factory';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const state = {};
  const role = { hidesOwnerActions: false };

  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });

  const selector = <T>(getter: (state: any, ...args: any[]) => T) =>
    Object.assign((...args: any[]) => readable(getter(state, ...args)), {
      select: (s: any, ...a: any[]) => getter(s ?? state, ...a),
    });

  return { dispatch, state, readable, selector, role };
});
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/') }));

vi.mock('$app/state', () => ({ page: pageState }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksLoading: mocks.selector(() => false),
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0 })),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: vi.fn((id) => ({
    type: 'workspace-tasks/ensureLoaded',
    payload: id,
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectHidesOwnerWorkspaceActions: mocks.selector(() => mocks.role.hidesOwnerActions),
}));

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: mocks.selector(() => []),
}));

vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import WorkspaceCard from '../WorkspaceCard.svelte';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activity: 'idle',
    displayStatus: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

async function openContextMenu(workspace: Workspace, onOpenInNewWindow?: () => void) {
  const { container } = render(WorkspaceCard, { props: { workspace, onOpenInNewWindow } });
  const row = container.querySelector('[data-workspace-card-row]')!;
  expect(row).toBeTruthy();
  await fireEvent.contextMenu(row);
  return container;
}

const menuItemNames = () =>
  screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');

beforeEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
  mocks.role.hidesOwnerActions = false;
});

describe('WorkspaceCard context menu owner gating', () => {
  it('offers Transfer, Archive and Delete to the workspace owner', async () => {
    await openContextMenu(makeWorkspace({ myRole: 'owner' }), vi.fn());

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(menuItemNames()).toEqual([
      'Open in New Window',
      'Transfer/Download…',
      'Archive',
      'Delete Workspace…',
    ]);
  });

  it('hides the owner-only actions from a collaborator and keeps the rest', async () => {
    mocks.role.hidesOwnerActions = true;
    const onOpenInNewWindow = vi.fn();
    await openContextMenu(makeWorkspace({ myRole: 'collaborator' }), onOpenInNewWindow);

    expect(menuItemNames()).toEqual(['Open in New Window']);
    expect(screen.queryByRole('menuitem', { name: /leave/i })).toBeNull();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in New Window' }));
    expect(onOpenInNewWindow).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/workspaceTransfer|delete|archive/i) }),
    );
  });

  it('opens no menu for a collaborator row when nothing would remain', async () => {
    mocks.role.hidesOwnerActions = true;
    const container = await openContextMenu(makeWorkspace({ myRole: 'collaborator' }));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(container.querySelector('[role="menuitem"]')).toBeNull();
  });
});

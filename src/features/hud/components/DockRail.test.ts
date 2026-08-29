import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
import type { DockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';

vi.mock(
  '$lib/components/workspace/WorkspaceHoverCard.svelte',
  async () => import('./DockRailPreviewStub.svelte'),
);

import DockRail from './DockRail.svelte';

function workspace(id: string, title = `Workspace ${id}`): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Workspace;
}

function dockItem(
  id: string,
  overrides: Partial<Omit<DockWorkspaceView, 'workspace'>> = {},
): DockWorkspaceView {
  return {
    workspace: workspace(id),
    badgeKind: 'none',
    priorityGroup: 'active',
    isUnread: false,
    isRunning: true,
    isWaiting: false,
    ...overrides,
  };
}

function pointerController(): DockPointerRegionController & {
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    activate: vi.fn(),
    deactivate: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('DockRail', () => {
  it('renders the localized icon-only empty state and routes the rail pointer region', async () => {
    const pointer = pointerController();
    const view = render(DockRail, { workspaces: [], pointerController: pointer });

    expect(screen.getByRole('status', { name: 'No active spaces' })).toBeTruthy();
    await fireEvent.pointerEnter(screen.getByTestId('dock-rail'));
    expect(pointer.activate).toHaveBeenCalledOnce();
    await fireEvent.pointerLeave(screen.getByTestId('dock-rail'));
    view.unmount();
    expect(pointer.destroy).toHaveBeenCalledOnce();
  });

  it('keeps an exiting entry briefly and animates badges only on appearance or escalation', async () => {
    const pointer = pointerController();
    const first = dockItem('one', { badgeKind: 'review', priorityGroup: 'action' });
    const second = dockItem('two');
    const view = render(DockRail, {
      workspaces: [first, second],
      pointerController: pointer,
    });

    await waitFor(() => expect(document.querySelector('[data-badge-kind="review"]')).toBeTruthy());
    const firstBadge = document.querySelector('[data-badge-kind="review"]');
    expect(firstBadge?.getAttribute('data-badge-animated')).toBe('true');

    await view.rerender({
      workspaces: [{ ...first, badgeKind: 'question' }, second],
      pointerController: pointer,
    });
    await waitFor(() => {
      expect(document.querySelector('[data-badge-kind="question"]')).not.toBe(firstBadge);
    });
    const escalatedBadge = document.querySelector('[data-badge-kind="question"]');

    await view.rerender({
      workspaces: [{ ...first, badgeKind: 'review' }, second],
      pointerController: pointer,
    });
    expect(document.querySelector('[data-badge-kind="review"]')).toBe(escalatedBadge);

    await view.rerender({ workspaces: [first], pointerController: pointer });
    expect(document.querySelector('[data-dock-entry="two"]')).toBeTruthy();
    // eslint-disable-next-line themis/selector-argument-stability -- DOM query callback, not a selector argument
    await waitFor(() => expect(document.querySelector('[data-dock-entry="two"]')).toBeNull(), {
      timeout: 500,
    });
  });

  it('shows the existing preview on hover and focus and supports keyboard movement', async () => {
    const pointer = pointerController();
    render(DockRail, {
      workspaces: [dockItem('one'), dockItem('two')],
      pointerController: pointer,
    });
    const buttons = screen.getAllByRole('button');

    await fireEvent.pointerEnter(buttons[0]);
    expect(screen.getByTestId('dock-preview')).toBeTruthy();
    expect(pointer.activate).toHaveBeenCalled();

    buttons[0].focus();
    await fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(screen.getByTestId('dock-preview')).toBeTruthy();

    await fireEvent.keyDown(buttons[1], { key: 'Escape' });
    expect(screen.queryByTestId('dock-preview')).toBeNull();
    expect(pointer.deactivate).toHaveBeenCalled();
  });

  it('opens the selected workspace without navigating the dock renderer', async () => {
    const pointer = pointerController();
    const onOpenWorkspace = vi.fn();
    render(DockRail, {
      workspaces: [dockItem('one')],
      pointerController: pointer,
      onOpenWorkspace,
    });

    await fireEvent.click(screen.getByRole('button', { name: /Workspace one/i }));
    expect(onOpenWorkspace).toHaveBeenCalledWith('one');
    expect(pointer.deactivate).toHaveBeenCalled();
  });
});

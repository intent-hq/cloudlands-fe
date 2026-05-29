/**
 * @vitest-environment jsdom
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const unreadAgentIds: string[] = [];
  const readable = <T>(value: T) => ({
    subscribe(run: (value: T) => void) {
      run(value);
      return () => {};
    },
  });
  return { dispatch, streamingAgentIds, unreadAgentIds, readable };
});

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/workspace/other-workspace') },
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => mocks.streamingAgentIds),
  },
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: { select: vi.fn(() => null) },
}));

vi.mock('$lib/store/slices/workspace-operations/workspace-operations-slice', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestArchiveWorkspace: vi.fn((id: string) => ({ type: 'archive', payload: [id] })),
  requestDeleteWorkspace: vi.fn((id: string) => ({ type: 'delete', payload: [id] })),
}));

vi.mock('$lib/store/slices/sidebar-nav/sidebar-nav-slice', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  incrementContextMenuOpen: vi.fn(() => ({ type: 'sidebar/incrementContextMenuOpen' })),
  decrementContextMenuOpen: vi.fn(() => ({ type: 'sidebar/decrementContextMenuOpen' })),
}));

vi.mock('$lib/store/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectUnreadAgentIds: vi.fn(() => mocks.readable(mocks.unreadAgentIds)),
  selectUnreadAgentIdsForWorkspace: { select: vi.fn(() => mocks.unreadAgentIds) },
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: Object.assign(vi.fn(() => mocks.readable([])), {
    select: vi.fn(() => []),
  }),
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/workspace/WorkspacePhaseIndicator.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/ui/RelativeTime.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../sidebar/__tests__/mocks/Fa.svelte')).default,
}));

const baseWorkspace = {
  id: 'ws-1',
  title: 'List Workspace',
  branch: 'feature/list-hover-card',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  statusMessage: 'Workspace hover card is wired into this list row.',
  createdAt: '2026-05-05T00:00:00.000Z',
  updatedAt: '2026-05-05T00:00:00.000Z',
  lastActivity: '2026-05-05T19:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
} as Workspace;

function rect({
  top,
  left,
  width,
  height,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('workspace hover card list integrations', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.streamingAgentIds.length = 0;
    mocks.unreadAgentIds.length = 0;
  });

  it('shows the shared workspace hover card for sidebar workspace list items', async () => {
    const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
      .default;
    const onClick = vi.fn();
    render(WorkspaceListItem, { props: { workspace: baseWorkspace, onClick } });

    expect(screen.queryByText(baseWorkspace.statusMessage!)).toBeNull();

    const row = screen.getByText('List Workspace').closest('[role="button"]')!;
    await fireEvent.mouseEnter(row);
    await tick();

    expect(screen.getByText(baseWorkspace.statusMessage!)).toBeTruthy();
    expect(screen.queryByText(baseWorkspace.branch)).toBeNull();
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.className).toContain('shadow-xl');
    expect(tooltip.className).toContain('overflow-y-auto');
    expect(tooltip.className).toContain('pointer-events-auto');
    expect(tooltip.className).not.toContain('pointer-events-none');
    expect(tooltip.className).not.toContain('shadow-none');

    await fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps sidebar workspace hover cards suppressed during keyboard navigation', async () => {
    const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
      .default;
    const onHover = vi.fn();
    render(WorkspaceListItem, { props: { workspace: baseWorkspace, suppressHover: true, onHover } });

    const row = screen.getByText('List Workspace').closest('[role="button"]')!;
    await fireEvent.mouseEnter(row);
    await tick();

    expect(onHover).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(baseWorkspace.statusMessage!)).toBeNull();
  });

  it('shows streaming sidebar workspace agents as hover-card agent rows', async () => {
    const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
      .default;
    const streamingAgentIds = ['agent-visible-in-sidebar'];
    mocks.streamingAgentIds.push(...streamingAgentIds);

    render(WorkspaceListItem, {
      props: { workspace: baseWorkspace, isRunning: true, streamingAgentIds },
    });

    const row = screen.getByText('List Workspace').closest('[role="button"]')!;
    await fireEvent.mouseEnter(row);
    await tick();

    expect(screen.getByRole('list', { name: 'Running agents' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /Agent Running/ })).toBeTruthy();
  });

  it('prefers placing sidebar workspace hover cards to the right of the row', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    const cardRect = rect({ top: 0, left: 0, width: 300, height: 120 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getMockRect(this: HTMLElement) {
        if (this.getAttribute('role') === 'tooltip') return cardRect;
        return rect({ top: 0, left: 0, width: 0, height: 0 });
      },
    );

    try {
      const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
        .default;
      render(WorkspaceListItem, { props: { workspace: baseWorkspace } });

      const row = screen.getByText('List Workspace').closest('[role="button"]') as HTMLElement;
      row.getBoundingClientRect = vi.fn(() => rect({ top: 40, left: 16, width: 224, height: 28 }));
      await fireEvent.mouseEnter(row);
      await tick();

      const tooltip = screen.getByRole('tooltip');
      await waitFor(() => expect(tooltip.style.left).toBe('244px'));
      expect(tooltip.style.top).toBe('40px');
      expect(tooltip.style.maxHeight).toBe('484px');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('flips sidebar workspace hover cards left when the right side is constrained', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    const cardRect = rect({ top: 0, left: 0, width: 300, height: 120 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getMockRect(this: HTMLElement) {
        if (this.getAttribute('role') === 'tooltip') return cardRect;
        return rect({ top: 0, left: 0, width: 0, height: 0 });
      },
    );

    try {
      const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
        .default;
      render(WorkspaceListItem, { props: { workspace: baseWorkspace } });

      const row = screen.getByText('List Workspace').closest('[role="button"]') as HTMLElement;
      row.getBoundingClientRect = vi.fn(() => rect({ top: 40, left: 360, width: 120, height: 28 }));
      await fireEvent.mouseEnter(row);
      await tick();

      const tooltip = screen.getByRole('tooltip');
      await waitFor(() => expect(tooltip.style.left).toBe('56px'));
      expect(tooltip.style.top).toBe('40px');
      expect(tooltip.style.maxHeight).toBe('484px');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('clamps side-placed workspace hover cards inside short viewports', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 160 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    const cardRect = rect({ top: 0, left: 0, width: 300, height: 220 });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getMockRect(this: HTMLElement) {
        if (this.getAttribute('role') === 'tooltip') return cardRect;
        return rect({ top: 0, left: 0, width: 0, height: 0 });
      },
    );

    try {
      const WorkspaceListItem = (await import('../../layout/sidebar-nav/WorkspaceListItem.svelte'))
        .default;
      render(WorkspaceListItem, { props: { workspace: baseWorkspace } });

      const row = screen.getByText('List Workspace').closest('[role="button"]') as HTMLElement;
      row.getBoundingClientRect = vi.fn(() => rect({ top: 120, left: 16, width: 224, height: 28 }));
      await fireEvent.mouseEnter(row);
      await tick();

      const tooltip = screen.getByRole('tooltip');
      await waitFor(() => expect(tooltip.style.top).toBe('8px'));
      expect(tooltip.style.left).toBe('192px');
      expect(tooltip.style.maxHeight).toBe('144px');
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('shows the shared workspace hover card for workspace table rows without breaking open', async () => {
    const WorkspaceTableRow = (await import('../WorkspaceTableRow.svelte')).default;
    const onOpen = vi.fn();
    render(WorkspaceTableRow, { props: { workspace: baseWorkspace, agents: [], onOpen } });

    const rowButton = screen.getByRole('button', { name: /List Workspace/i });
    await fireEvent.mouseEnter(rowButton.parentElement!);
    await tick();

    expect(screen.getByText(baseWorkspace.statusMessage!)).toBeTruthy();
    expect(screen.queryByText(baseWorkspace.branch)).toBeNull();

    await fireEvent.click(rowButton);
    expect(onOpen).toHaveBeenCalledWith(baseWorkspace, expect.any(MouseEvent));
  });
});

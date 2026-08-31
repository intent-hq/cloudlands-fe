import { m } from '$shared/paraglide/messages.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
import { store as appStore } from '$store/renderer/store';
import {
  removeWorkspaceEntity,
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  setAllSpacesViewMode,
  hydrateSidebarNav,
  setShowArchivedWorkspaces,
  togglePinWorkspace,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

const setPinnedWorkspaceIds = (ids: string[]) => hydrateSidebarNav({ pinnedWorkspaceIds: ids });

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    fetchActiveStreams: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

function workspace(repo: string, index: number, activityDay = 10 - index): Workspace {
  const timestamp = `2026-08-${String(activityDay).padStart(2, '0')}T12:00:00.000Z`;
  return {
    id: `${repo}-${index}` as WorkspaceId,
    title: `${repo} space ${index}`,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryName: repo,
    repositoryPath: `/tmp/${repo}`,
    worktreePath: `/tmp/${repo}-${index}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivity: timestamp,
  };
}

function seedRepository(repo: string, count: number, dayOffset = 0) {
  for (let index = 1; index <= count; index += 1) {
    appStore.dispatch(setWorkspaceEntity(workspace(repo, index, 20 - dayOffset - index)));
  }
}

function renderRepositoryView(setup: () => void) {
  return render(AllWorkspacesCardHarness, {
    props: {
      expanded: true,
      setup: () => {
        setup();
        appStore.dispatch(setWorkspaceHasLoaded(true));
        appStore.dispatch(setAllSpacesViewMode('repo'));
      },
    },
  });
}

function repositoryGroup(label: string): HTMLElement {
  return screen
    .getByRole('heading', { level: 4, name: label })
    .closest('[data-repository-group]') as HTMLElement;
}

function rowIds(group: HTMLElement): string[] {
  return [...group.querySelectorAll('[data-repository-space-row]')].map(
    (row) => row.getAttribute('data-workspace-id') ?? '',
  );
}

function setGeometry(element: Element, left: number, width: number, height = 28): void {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    scrollWidth: { configurable: true, value: width },
  });
  element.getBoundingClientRect = () =>
    ({
      x: left,
      y: 0,
      left,
      right: left + width,
      top: 0,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('AllWorkspacesCard repository disclosure', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(setPinnedWorkspaceIds([]));
    appStore.dispatch(setAllSpacesViewMode('recent'));
    appStore.dispatch(setShowArchivedWorkspaces(false));
    vi.mocked(goto).mockReset();
  });

  it('renders all three members without a disclosure control', async () => {
    renderRepositoryView(() => seedRepository('alpha', 3));

    await waitFor(() => expect(rowIds(repositoryGroup('alpha'))).toHaveLength(3));
    expect(
      within(repositoryGroup('alpha')).queryByRole('button', { name: 'Show more' }),
    ).toBeNull();
  });

  it('renders three of four activity-ordered members and keeps pinning semantics', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const group = await waitFor(() => repositoryGroup('alpha'));
    expect(rowIds(group)).toEqual(['alpha-1', 'alpha-2', 'alpha-3']);
    expect(
      within(group).getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded'),
    ).toBe('false');

    appStore.dispatch(togglePinWorkspace('alpha-4'));
    await waitFor(() => expect(rowIds(group)).toEqual(['alpha-4', 'alpha-1', 'alpha-2']));
  });

  it('renders a compact left-aligned text action with transparent interaction states', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const group = await waitFor(() => repositoryGroup('alpha'));
    const heading = within(group).getByRole('heading', { level: 4, name: 'alpha' });
    const toggle = within(group).getByRole('button', { name: 'Show more' });
    const label = toggle.querySelector('[data-repository-group-toggle-label]') as HTMLElement;
    const container = toggle.closest('.min-w-0') as HTMLElement;

    expect(container.className).toContain('min-w-0');
    expect(container.className).toContain('px-2');
    expect(toggle.className).toContain('type-caption');
    expect(toggle.className).toContain('min-h-7');
    expect(toggle.className).toContain('w-fit');
    expect(toggle.className).toContain('max-w-full');
    expect(toggle.className).toContain('justify-start');
    expect(toggle.className).toContain('text-left');
    expect(toggle.className).toContain('font-normal');
    expect(toggle.className).toContain('text-muted-foreground');
    expect(toggle.className).toContain('border-0');
    expect(toggle.className).toContain('bg-transparent');
    expect(toggle.className).toContain('shadow-none');
    expect(toggle.className).toContain('hover:bg-transparent');
    expect(toggle.className).toContain('active:bg-transparent');
    expect(toggle.className).toContain('focus-visible:bg-transparent');
    expect(toggle.className).toContain('focus-visible:text-foreground');
    expect(toggle.className).toContain('focus-visible:underline');
    expect(toggle.className).toContain('focus-visible:outline-none');
    expect(toggle.className).toContain('focus-visible:ring-0!');
    expect(toggle.classList.contains('w-full')).toBe(false);
    expect(toggle.className).not.toMatch(/focus-visible:outline-(?!none(?:\s|$)|0(?:\s|$))\S+/);
    expect(toggle.className).not.toMatch(/focus-visible:(?:shadow|ring-offset)-\S+/);

    setGeometry(group, 0, 240);
    setGeometry(container, 0, 240);
    setGeometry(toggle, 4, 72);
    setGeometry(heading, 8, 48, 16);
    setGeometry(label, 8, 64, 16);

    expect(toggle.getBoundingClientRect().width).toBeLessThan(
      container.getBoundingClientRect().width,
    );
    expect(label.getBoundingClientRect().left).toBe(heading.getBoundingClientRect().left);
    expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(
      group.getBoundingClientRect().right,
    );
  });

  it('keeps its content-sized hit target contained at narrow and zoom-equivalent widths', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const group = await waitFor(() => repositoryGroup('alpha'));
    const toggle = within(group).getByRole('button', { name: 'Show more' });

    for (const containerWidth of [160, 80]) {
      setGeometry(group, 0, containerWidth);
      setGeometry(toggle, 4, Math.min(72, containerWidth - 8));
      expect(toggle.getBoundingClientRect().width).toBeLessThan(
        group.getBoundingClientRect().width,
      );
      expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(
        group.getBoundingClientRect().right,
      );
      expect(toggle.scrollWidth).toBeLessThanOrEqual(toggle.clientWidth);
    }

    expect(toggle.className).toContain('overflow-hidden');
    expect(toggle.className).toContain('motion-reduce:transition-none');
  });

  it('expands and collapses repository groups independently', async () => {
    renderRepositoryView(() => {
      seedRepository('alpha', 4);
      seedRepository('beta', 4, 10);
    });

    const alpha = await waitFor(() => repositoryGroup('alpha'));
    const beta = repositoryGroup('beta');
    await fireEvent.click(within(alpha).getByRole('button', { name: 'Show more' }));
    expect(rowIds(alpha)).toHaveLength(4);
    expect(rowIds(beta)).toHaveLength(3);

    await fireEvent.click(within(beta).getByRole('button', { name: 'Show more' }));
    expect(rowIds(alpha)).toHaveLength(4);
    expect(rowIds(beta)).toHaveLength(4);

    await fireEvent.click(within(alpha).getByRole('button', { name: 'Show less' }));
    expect(rowIds(alpha)).toHaveLength(3);
    expect(rowIds(beta)).toHaveLength(4);
    expect(
      within(alpha).getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      within(beta).getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('activates exactly once for pointer, Enter, and Space while retaining focus semantics', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const group = await waitFor(() => repositoryGroup('alpha'));
    let toggle = within(group).getByRole('button', { name: 'Show more' });

    await fireEvent.click(toggle);
    expect(rowIds(group)).toHaveLength(4);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(within(group).getByRole('button', { name: 'Show less' }));
    expect(rowIds(group)).toHaveLength(3);

    toggle = within(group).getByRole('button', { name: 'Show more' });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    await fireEvent.keyDown(toggle, { key: 'Enter' });
    await fireEvent.click(toggle);
    await fireEvent.keyUp(toggle, { key: 'Enter' });
    expect(rowIds(group)).toHaveLength(4);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle = within(group).getByRole('button', { name: 'Show less' });
    toggle.focus();
    await fireEvent.keyDown(toggle, { key: ' ' });
    await fireEvent.keyUp(toggle, { key: ' ' });
    await fireEvent.click(toggle);
    expect(rowIds(group)).toHaveLength(3);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals matching search results without changing collapsed state', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const search = await screen.findByPlaceholderText(m.layout_activeCard_search_placeholder());
    await fireEvent.input(search, { target: { value: 'alpha space 4' } });
    await waitFor(() => expect(rowIds(repositoryGroup('alpha'))).toEqual(['alpha-4']));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();

    await fireEvent.input(search, { target: { value: '' } });
    await waitFor(() =>
      expect(rowIds(repositoryGroup('alpha'))).toEqual(['alpha-1', 'alpha-2', 'alpha-3']),
    );
    expect(screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('applies disclosure to eligible archived rows without losing expansion state', async () => {
    renderRepositoryView(() => {
      seedRepository('alpha', 3);
      appStore.dispatch(
        setWorkspaceEntity({
          ...workspace('alpha', 4, 10),
          title: 'Archived alpha space',
          status: WorkspaceStatus.Archived,
        }),
      );
    });

    const group = await waitFor(() => repositoryGroup('alpha'));
    expect(rowIds(group)).toHaveLength(3);
    expect(within(group).queryByRole('button', { name: 'Show more' })).toBeNull();

    appStore.dispatch(setShowArchivedWorkspaces(true));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'Show more' })).toBeTruthy(),
    );
    await fireEvent.click(within(group).getByRole('button', { name: 'Show more' }));
    expect(rowIds(group)).toHaveLength(4);

    appStore.dispatch(setShowArchivedWorkspaces(false));
    await waitFor(() => expect(rowIds(group)).toHaveLength(3));
    appStore.dispatch(setShowArchivedWorkspaces(true));
    await waitFor(() => expect(rowIds(group)).toHaveLength(4));
    expect(within(group).getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('keeps keyboard navigation and focus order aligned to collapsed rows', async () => {
    renderRepositoryView(() => seedRepository('alpha', 4));

    const search = await screen.findByPlaceholderText(m.layout_activeCard_search_placeholder());
    const group = repositoryGroup('alpha');
    const triggers = group.querySelectorAll('[data-workspace-card-trigger]');
    const toggle = within(group).getByRole('button', { name: 'Show more' });
    expect(triggers).toHaveLength(3);
    expect(
      triggers[2].compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await fireEvent.keyDown(search, { key: 'End' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/workspace/alpha-3'));
    expect(document.activeElement).toBe(search);
  });

  it('recomputes collapsed rows and clears expansion after a repository disappears', async () => {
    renderRepositoryView(() => seedRepository('alpha', 3));
    await waitFor(() => expect(rowIds(repositoryGroup('alpha'))).toHaveLength(3));

    appStore.dispatch(setWorkspaceEntity(workspace('alpha', 4, 30)));
    await waitFor(() =>
      expect(rowIds(repositoryGroup('alpha'))).toEqual(['alpha-4', 'alpha-1', 'alpha-2']),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(rowIds(repositoryGroup('alpha'))).toHaveLength(4);

    for (let index = 1; index <= 4; index += 1) {
      appStore.dispatch(removeWorkspaceEntity(`alpha-${index}`));
    }
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alpha' })).toBeNull());
    await tick();

    seedRepository('alpha', 4);
    await waitFor(() => expect(rowIds(repositoryGroup('alpha'))).toHaveLength(3));
    expect(screen.getByRole('button', { name: 'Show more' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});

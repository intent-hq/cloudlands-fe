/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PanelEmptyState from '../PanelEmptyState.svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  focusedPanelId: 'panel-1' as string | null,
  recentlyClosed: [] as Array<{ tab: Record<string, unknown>; closedAt: number }>,
  shortcuts: {
    'workspace.new-agent': 'mod+alt+a',
    'workspace.new-note': 'mod+alt+n',
    'workspace.new-terminal': 'mod+alt+t',
    'workspace.new-browser': 'mod+alt+b',
    'navigation.new-tab': 'mod+t',
    'global.command-palette-alt': 'mod+k',
    'navigation.reopen-tab': 'mod+shift+t',
    'panel.toggle-sidebar': 'mod+b',
    'global.keyboard-shortcuts': 'mod+?',
  } as Record<string, string>,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));

vi.mock('$lib/utils/effective-shortcuts', async () => {
  const { readable } = await import('svelte/store');
  return {
    effectiveShortcutReadable: (id: string) => readable(mocks.shortcuts[id]),
  };
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectRecentlyClosed: () => readable(mocks.recentlyClosed),
    selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  };
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectAllWorkspaceAgents: () => readable([]) };
});

vi.mock('$store/renderer/slices/terminals/terminals-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectTerminalsForWorkspace: () => readable([]) };
});

vi.mock('$store/renderer/slices/palette/palette-slice', () => ({
  openPalette: () => ({ type: 'palette/open' }),
}));

vi.mock('$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice', () => ({
  openCheatSheet: (category: string) => ({ type: 'shortcuts/open', payload: category }),
}));

function renderEmptyState(props: Record<string, unknown> = {}) {
  const layoutManager = {
    splitPanel: vi.fn(),
    reopenClosedTab: vi.fn(),
  };
  render(PanelEmptyState, {
    props: { workspaceId: 'workspace-1', panelId: 'panel-1', ...props },
    context: new Map([['panelLayoutManager', () => layoutManager]]),
  });
  return layoutManager;
}

describe('PanelEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.focusedPanelId = 'panel-1';
    mocks.recentlyClosed = [];
    mocks.shortcuts['workspace.new-agent'] = 'mod+alt+a';
  });

  it('creates an agent directly from the primary action', async () => {
    const onCreateAgent = vi.fn();
    renderEmptyState({ onCreateAgent });

    await fireEvent.click(screen.getByRole('button', { name: 'New Agent' }));

    expect(onCreateAgent).toHaveBeenCalledOnce();
    expect(onCreateAgent).toHaveBeenCalledWith('panel-1');
  });

  it('creates a panel from the focused panel and presents Mod+T as New Panel', async () => {
    const layoutManager = renderEmptyState();

    const newPanel = screen.getByRole('button', { name: /^New panel/i });
    expect(newPanel.textContent).toMatch(/Ctrl\+T|⌘T/);
    await fireEvent.click(newPanel);

    expect(layoutManager.splitPanel).toHaveBeenCalledWith('panel-1', 'horizontal');
    expect(screen.queryByText('Create Column to Right')).toBeNull();
  });

  it('renders resolved creation hints and runs the available actions', async () => {
    mocks.shortcuts['workspace.new-agent'] = 'mod+alt+g';
    const onCreateNote = vi.fn();
    const onCreateTerminal = vi.fn();
    const onOpenBrowser = vi.fn();
    const onCreateAgent = vi.fn();
    const layoutManager = renderEmptyState({
      onCreateAgent,
      onCreateNote,
      onCreateTerminal,
      onOpenBrowser,
    });

    const creationRows = [
      ['New Agent', 'Ctrl+Alt+G'],
      ['New Note', 'Ctrl+Alt+N'],
      ['New Terminal', 'Ctrl+Alt+T'],
      ['New Browser', 'Ctrl+Alt+B'],
    ] as const;
    for (const [name, hint] of creationRows) {
      const row = screen.getByRole('button', { name });
      expect(row.textContent).toContain(hint);
      await fireEvent.click(row);
    }
    await fireEvent.click(screen.getByRole('button', { name: /Command palette/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Reopen closed/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Toggle sidebar/ }));
    await fireEvent.click(screen.getByRole('button', { name: /All shortcuts/ }));

    expect(onCreateAgent).toHaveBeenCalledWith('panel-1');
    expect(onCreateNote).toHaveBeenCalledOnce();
    expect(onCreateNote).toHaveBeenCalledWith('panel-1');
    expect(onCreateTerminal).toHaveBeenCalledOnce();
    expect(onCreateTerminal).toHaveBeenCalledWith('panel-1');
    expect(onOpenBrowser).toHaveBeenCalledWith('panel-1');
    expect(layoutManager.reopenClosedTab).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'palette/open' });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'uiLayout/toggleSidebar', payload: [] });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'shortcuts/open', payload: 'global' });
  });

  it('only shows the reopen hint when a recent item is available', async () => {
    const withoutRecents = renderEmptyState();
    expect(screen.queryByRole('button', { name: /^Reopen last closed/i })).toBeNull();

    withoutRecents.reopenClosedTab.mockClear();
    mocks.recentlyClosed = [
      {
        tab: { id: 'recent-note', type: 'note', title: 'Recent note' },
        closedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      },
    ];
    const withRecents = renderEmptyState();
    expect(screen.getByTitle('Reopen Recent note').textContent?.trim()).toBe('Recent note');
    await fireEvent.click(screen.getByRole('button', { name: /^Reopen last closed/i }));

    expect(withRecents.reopenClosedTab).toHaveBeenCalledOnce();
  });
});

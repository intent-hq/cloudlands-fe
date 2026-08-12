/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PanelEmptyState from '../PanelEmptyState.svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  focusedPanelId: 'panel-1' as string | null,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectRecentlyClosed: () => readable([]),
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
    props: { workspaceId: 'workspace-1', ...props },
    context: new Map([['panelLayoutManager', () => layoutManager]]),
  });
  return layoutManager;
}

describe('PanelEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.focusedPanelId = 'panel-1';
  });

  it('creates an agent directly from the primary action', async () => {
    const onCreateAgent = vi.fn();
    renderEmptyState({ onCreateAgent });

    await fireEvent.click(screen.getByRole('button', { name: 'New Agent' }));

    expect(onCreateAgent).toHaveBeenCalledOnce();
  });

  it('creates a panel from the focused panel and presents Mod+T as New Panel', async () => {
    const layoutManager = renderEmptyState();

    const newPanel = screen.getByRole('button', { name: /^New panel/i });
    expect(newPanel.textContent).toMatch(/Ctrl\+T|⌘T/);
    await fireEvent.click(newPanel);

    expect(layoutManager.splitPanel).toHaveBeenCalledWith('panel-1', 'horizontal');
    expect(screen.queryByText('Split Panel Horizontally')).toBeNull();
  });

  it('runs the available tool and help actions', async () => {
    const onCreateNote = vi.fn();
    const onCreateTerminal = vi.fn();
    const layoutManager = renderEmptyState({ onCreateNote, onCreateTerminal });

    await fireEvent.click(screen.getByRole('button', { name: 'New Note' }));
    await fireEvent.click(screen.getByRole('button', { name: 'New Terminal' }));
    await fireEvent.click(screen.getByRole('button', { name: /Command palette/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Reopen closed/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Toggle sidebar/ }));
    await fireEvent.click(screen.getByRole('button', { name: /All shortcuts/ }));

    expect(onCreateNote).toHaveBeenCalledOnce();
    expect(onCreateTerminal).toHaveBeenCalledOnce();
    expect(layoutManager.reopenClosedTab).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'palette/open' });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'uiLayout/toggleSidebar', payload: [] });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'shortcuts/open', payload: 'global' });
  });

  it('uses cards for every available creation action without explainer copy', () => {
    renderEmptyState({
      onCreateAgent: vi.fn(),
      onCreateNote: vi.fn(),
      onCreateTerminal: vi.fn(),
      onOpenBrowser: vi.fn(),
    });

    const creationButtons = ['New Agent', 'New Note', 'New Terminal', 'New Browser'].map((name) =>
      screen.getByRole('button', { name: new RegExp(`^${name}`) }),
    );
    for (const button of creationButtons) {
      expect(button.className).toContain('creation-card');
      expect(button.className).toContain('min-h-16');
      expect(button.className).toContain('bg-muted/30');
      expect(button.className).not.toContain('shadow');
      expect(button.className).not.toContain('hover:bg-');
    }
    expect(creationButtons[0].parentElement?.className).toContain('creation-grid');
    expect(screen.getByRole('button', { name: /^New panel/i }).className).not.toContain(
      'creation-card',
    );
    expect(
      screen.getByRole('button', { name: /^New panel/i }).parentElement?.className,
    ).not.toContain('border-t');
    expect(screen.queryByText('Empty panel')).toBeNull();
    expect(screen.queryByText(/Start something here/)).toBeNull();
  });
});

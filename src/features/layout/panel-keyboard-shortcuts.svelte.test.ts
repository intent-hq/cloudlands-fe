import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayoutManager } from './panel-layout-adapter';

const mocks = vi.hoisted(() => ({ focusedPanelId: 'p1' as string | null }));

vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  selectFocusedPanel: { select: () => null },
  selectCanGoBack: { select: () => false },
  selectCanGoForward: { select: () => false },
  selectPanelLayoutWorkspace: { select: () => null },
  selectPanelIds: { select: () => [] },
}));

import { createPanelKeyboardShortcuts } from './panel-keyboard-shortcuts.svelte';

describe('fixed-column panel keyboard shortcuts', () => {
  const splitPanel = vi.fn();
  const manager = { workspaceId: 'ws', splitPanel } as unknown as PanelLayoutManager;

  beforeEach(() => {
    splitPanel.mockClear();
    mocks.focusedPanelId = 'p1';
  });

  it('keeps split-right horizontal', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager);

    shortcuts.executeAction('split-right');

    expect(splitPanel).toHaveBeenCalledWith('p1', 'horizontal');
    shortcuts.cleanup();
  });

  it('does not map the former split-down leader key', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager);
    shortcuts.activateLeader();
    const event = new KeyboardEvent('keydown', { key: '"', shiftKey: true });

    expect(shortcuts.handleKeyDown(event)).toBe(true);
    expect(splitPanel).not.toHaveBeenCalled();
    expect(shortcuts.leaderActive).toBe(false);
    shortcuts.cleanup();
  });
});

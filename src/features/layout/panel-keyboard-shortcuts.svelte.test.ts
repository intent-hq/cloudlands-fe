/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayoutManager } from './panel-layout-adapter';

const mocks = vi.hoisted(() => ({
  focusedPanelId: 'p1' as string | null,
  panelIds: ['p1', 'p2'] as string[],
  focusedPanel: {
    id: 'p1',
    activeTabId: 'pane-1',
    tabs: [{ id: 'pane-1' }, { id: 'pane-2' }],
  } as { id: string; activeTabId: string | null; tabs: Array<{ id: string }> } | null,
}));

vi.mock('$store/renderer/store', () => ({ store: { state: {} } }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  selectFocusedPanel: { select: () => mocks.focusedPanel },
  selectPanelLayoutWorkspace: { select: () => null },
  selectPanelIds: { select: () => mocks.panelIds },
}));

import { createPanelKeyboardShortcuts } from './panel-keyboard-shortcuts.svelte';

describe('fixed-column panel keyboard shortcuts', () => {
  const splitPanel = vi.fn();
  const selectNextTab = vi.fn();
  const selectPreviousTab = vi.fn();
  const moveTabToPanel = vi.fn();
  const focusPanel = vi.fn();
  const manager = {
    workspaceId: 'ws',
    splitPanel,
    selectNextTab,
    selectPreviousTab,
    moveTabToPanel,
    focusPanel,
  } as unknown as PanelLayoutManager;

  function event(
    key: string,
    init: KeyboardEventInit = {},
    target: Element = document.body,
  ): KeyboardEvent {
    const keyboardEvent = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    Object.defineProperty(keyboardEvent, 'target', { value: target });
    return keyboardEvent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.focusedPanelId = 'p1';
    mocks.panelIds = ['p1', 'p2'];
    mocks.focusedPanel = {
      id: 'p1',
      activeTabId: 'pane-1',
      tabs: [{ id: 'pane-1' }, { id: 'pane-2' }],
    };
  });

  it('keeps split-right horizontal', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager);

    shortcuts.executeAction('split-right');

    expect(splitPanel).toHaveBeenCalledWith('p1', 'horizontal');
    shortcuts.cleanup();
  });

  it.each([
    ['macOS', true, { metaKey: true }],
    ['Windows/Linux', false, { ctrlKey: true }],
  ] as const)('uses the platform Mod key for pane selection on %s', (_platform, isMac, mod) => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, { isMac });
    const next = event('PageDown', mod);
    const previous = event('PageUp', mod);

    expect(shortcuts.handleKeyDown(next)).toBe(true);
    expect(shortcuts.handleKeyDown(previous)).toBe(true);
    expect(next.defaultPrevented).toBe(true);
    expect(previous.defaultPrevented).toBe(true);
    expect(selectNextTab).toHaveBeenCalledWith('p1');
    expect(selectPreviousTab).toHaveBeenCalledWith('p1');
    shortcuts.cleanup();
  });

  it.each([
    ['macOS Control', true, { ctrlKey: true }],
    ['Windows/Linux Command', false, { metaKey: true }],
    ['mixed modifiers', true, { metaKey: true, ctrlKey: true }],
  ] as const)('leaves %s pane chords unhandled', (_label, isMac, mod) => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, { isMac });

    expect(shortcuts.handleKeyDown(event('PageDown', mod))).toBe(false);
    expect(selectNextTab).not.toHaveBeenCalled();
    shortcuts.cleanup();
  });

  it('focuses and moves only when an adjacent column exists', () => {
    const onFocusAdjacentColumn = vi.fn(() => true);
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
      onFocusAdjacentColumn,
    });

    expect(shortcuts.handleKeyDown(event('PageDown', { metaKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(onFocusAdjacentColumn).toHaveBeenCalledWith('next');
    expect(shortcuts.handleKeyDown(event('PageDown', { metaKey: true, altKey: true }))).toBe(true);
    expect(moveTabToPanel).toHaveBeenCalledWith('pane-1', 'p1', 'p2');

    mocks.panelIds = ['p1'];
    expect(shortcuts.handleKeyDown(event('PageDown', { metaKey: true, altKey: true }))).toBe(false);
    expect(moveTabToPanel).toHaveBeenCalledOnce();
    shortcuts.cleanup();
  });

  it('does not consume disabled pane, focus, or column creation commands', () => {
    mocks.focusedPanel = { id: 'p1', activeTabId: 'pane-1', tabs: [{ id: 'pane-1' }] };
    mocks.panelIds = ['p1', 'p2', 'p3', 'p4'];
    const onFocusAdjacentColumn = vi.fn(() => false);
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: false,
      onFocusAdjacentColumn,
    });

    expect(shortcuts.handleKeyDown(event('PageDown', { ctrlKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('PageDown', { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(shortcuts.handleKeyDown(event('\\', { ctrlKey: true }))).toBe(false);
    expect(splitPanel).not.toHaveBeenCalled();
    shortcuts.cleanup();
  });

  it('creates a column to the right below the four-column limit', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: false,
    });
    const create = event('\\', { ctrlKey: true });

    expect(shortcuts.handleKeyDown(create)).toBe(true);
    expect(create.defaultPrevented).toBe(true);
    expect(splitPanel).toHaveBeenCalledWith('p1', 'horizontal');
    shortcuts.cleanup();
  });

  it.each([
    ['input', () => document.createElement('input')],
    [
      'editor',
      () => {
        const target = document.createElement('div');
        target.setAttribute('contenteditable', 'true');
        return target;
      },
    ],
    [
      'terminal',
      () => {
        const target = document.createElement('textarea');
        target.classList.add('xterm-helper-textarea');
        return target;
      },
    ],
  ])('preserves %s ownership', (_context, createTarget) => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
    });

    expect(shortcuts.handleKeyDown(event('PageDown', { metaKey: true }, createTarget()))).toBe(
      false,
    );
    expect(selectNextTab).not.toHaveBeenCalled();
    shortcuts.cleanup();
  });

  it('leaves browser-history chords and native zoom reset unhandled', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
    });

    expect(shortcuts.handleKeyDown(event('[', { metaKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event(']', { metaKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('0', { metaKey: true }))).toBe(false);
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

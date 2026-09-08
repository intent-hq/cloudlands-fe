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
  shortcutOverrides: {} as Record<string, string>,
}));

vi.mock('$store/renderer/store', () => ({
  store: { state: { userPreferences: { shortcutOverrides: mocks.shortcutOverrides } } },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  selectFocusedPanel: { select: () => mocks.focusedPanel },
  selectPanelLayoutWorkspace: { select: () => null },
  selectPanelIds: { select: () => mocks.panelIds },
}));

import { createPanelKeyboardShortcuts } from './panel-keyboard-shortcuts.svelte';

describe('fixed-column panel keyboard shortcuts', () => {
  const editableTargetFactories: Array<[string, () => HTMLElement]> = [
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
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
  ];
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
    for (const key of Object.keys(mocks.shortcutOverrides)) delete mocks.shortcutOverrides[key];
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
  ] as const)(
    'uses both unshifted bracket pane shortcuts from all targets on %s',
    (_platform, isMac, mod) => {
      const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
        isMac,
      });
      const targets: Array<[string, () => HTMLElement]> = [
        ['ordinary content', () => document.body],
        ...editableTargetFactories,
      ];

      for (const [_context, createTarget] of targets) {
        const next = event(']', mod, createTarget());
        const previous = event('[', mod, createTarget());

        expect(shortcuts.handleKeyDown(next)).toBe(true);
        expect(shortcuts.handleKeyDown(previous)).toBe(true);
        expect(next.defaultPrevented).toBe(true);
        expect(previous.defaultPrevented).toBe(true);
        expect(selectNextTab).toHaveBeenLastCalledWith('p1');
        expect(selectPreviousTab).toHaveBeenLastCalledWith('p1');
      }
      shortcuts.cleanup();
    },
  );

  it.each([
    ['macOS Control', true, { ctrlKey: true }],
    ['Windows/Linux Command', false, { metaKey: true }],
    ['mixed modifiers', true, { metaKey: true, ctrlKey: true }],
  ] as const)('leaves %s pane chords unhandled', (_label, isMac, mod) => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, { isMac });

    expect(shortcuts.handleKeyDown(event(']', mod))).toBe(false);
    expect(selectNextTab).not.toHaveBeenCalled();
    shortcuts.cleanup();
  });

  it.each([
    ['macOS', true, { metaKey: true }],
    ['Windows/Linux', false, { ctrlKey: true }],
  ] as const)(
    'uses both Mod+Shift bracket variants to focus columns from all targets on %s',
    (_platform, isMac, mod) => {
      const onFocusAdjacentColumn = vi.fn(() => true);
      const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
        isMac,
        onFocusAdjacentColumn,
      });

      const targets: Array<[string, () => HTMLElement]> = [
        ['ordinary content', () => document.body],
        ...editableTargetFactories,
      ];
      const chords = [
        [']', 'next'],
        ['}', 'next'],
        ['[', 'prev'],
        ['{', 'prev'],
      ] as const;

      for (const [_context, createTarget] of targets) {
        for (const [key, direction] of chords) {
          const keyEvent = event(key, { ...mod, shiftKey: true }, createTarget());
          expect(shortcuts.handleKeyDown(keyEvent)).toBe(true);
          expect(keyEvent.defaultPrevented).toBe(true);
          expect(onFocusAdjacentColumn).toHaveBeenLastCalledWith(direction);
        }
      }
      shortcuts.cleanup();
    },
  );

  it.each([
    ['macOS', true, { metaKey: true }],
    ['Windows/Linux', false, { ctrlKey: true }],
  ] as const)(
    'leaves unavailable Mod+Shift column directions native on %s',
    (_platform, isMac, mod) => {
      const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
        isMac,
      });
      const targets: Array<[string, () => HTMLElement]> = [
        ['ordinary content', () => document.body],
        ...editableTargetFactories,
      ];

      for (const [_context, createTarget] of targets) {
        mocks.focusedPanelId = 'p1';
        const previous = event('[', { ...mod, shiftKey: true }, createTarget());
        expect(shortcuts.handleKeyDown(previous)).toBe(false);
        expect(previous.defaultPrevented).toBe(false);

        mocks.focusedPanelId = 'p2';
        const next = event('}', { ...mod, shiftKey: true }, createTarget());
        expect(shortcuts.handleKeyDown(next)).toBe(false);
        expect(next.defaultPrevented).toBe(false);
      }
      expect(focusPanel).not.toHaveBeenCalled();
      shortcuts.cleanup();
    },
  );

  it('keeps PageUp/PageDown pane-move compatibility aliases', () => {
    const onFocusAdjacentColumn = vi.fn(() => true);
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
      onFocusAdjacentColumn,
    });

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

    expect(shortcuts.handleKeyDown(event(']', { ctrlKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('}', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('\\', { ctrlKey: true }))).toBe(false);
    expect(splitPanel).not.toHaveBeenCalled();
    shortcuts.cleanup();
  });

  it.each([
    ['macOS', true, { metaKey: true }],
    ['Windows/Linux', false, { ctrlKey: true }],
  ] as const)(
    'leaves unavailable unshifted pane directions native on %s',
    (_platform, isMac, mod) => {
      mocks.focusedPanel = { id: 'p1', activeTabId: 'pane-1', tabs: [{ id: 'pane-1' }] };
      const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
        isMac,
      });
      const targets: Array<[string, () => HTMLElement]> = [
        ['ordinary content', () => document.body],
        ...editableTargetFactories,
      ];

      for (const [_context, createTarget] of targets) {
        const next = event(']', mod, createTarget());
        const previous = event('[', mod, createTarget());

        expect(shortcuts.handleKeyDown(next)).toBe(false);
        expect(shortcuts.handleKeyDown(previous)).toBe(false);
        expect(next.defaultPrevented).toBe(false);
        expect(previous.defaultPrevented).toBe(false);
      }
      expect(selectNextTab).not.toHaveBeenCalled();
      expect(selectPreviousTab).not.toHaveBeenCalled();
      shortcuts.cleanup();
    },
  );

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

  it.each(editableTargetFactories)(
    'preserves all other %s shortcut protections',
    (_context, createTarget) => {
      const onFocusAdjacentColumn = vi.fn(() => true);
      const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
        isMac: true,
        onFocusAdjacentColumn,
      });
      const target = createTarget();
      const protectedEvents = [
        event('PageDown', { metaKey: true, shiftKey: true }, target),
        event('PageDown', { metaKey: true, altKey: true }, target),
        event('\\', { metaKey: true }, target),
        event(';', { metaKey: true }, target),
      ];

      for (const keyEvent of protectedEvents) {
        expect(shortcuts.handleKeyDown(keyEvent)).toBe(false);
        expect(keyEvent.defaultPrevented).toBe(false);
      }
      expect(selectNextTab).not.toHaveBeenCalled();
      expect(onFocusAdjacentColumn).not.toHaveBeenCalled();
      expect(moveTabToPanel).not.toHaveBeenCalled();
      expect(splitPanel).not.toHaveBeenCalled();
      expect(shortcuts.leaderActive).toBe(false);

      shortcuts.activateLeader();
      const leaderAction = event('x', {}, target);
      expect(shortcuts.handleKeyDown(leaderAction)).toBe(false);
      expect(leaderAction.defaultPrevented).toBe(false);
      expect(shortcuts.leaderActive).toBe(true);
      shortcuts.cleanup();
    },
  );

  it('leaves legacy pane aliases and native zoom reset unhandled', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
    });

    expect(shortcuts.handleKeyDown(event('PageUp', { metaKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('PageDown', { metaKey: true }))).toBe(false);
    expect(shortcuts.handleKeyDown(event('0', { metaKey: true }))).toBe(false);
    shortcuts.cleanup();
  });

  it('maps the configurable split-right leader key', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager);
    shortcuts.activateLeader();
    const event = new KeyboardEvent('keydown', { key: '%', shiftKey: true });

    expect(shortcuts.handleKeyDown(event)).toBe(true);
    expect(splitPanel).toHaveBeenCalledWith('p1', 'horizontal');
    expect(shortcuts.leaderActive).toBe(false);
    shortcuts.cleanup();
  });

  it('leaves the former split-down leader key unbound', () => {
    const shortcuts = createPanelKeyboardShortcuts(() => manager);
    shortcuts.activateLeader();
    const event = new KeyboardEvent('keydown', { key: '"', shiftKey: true });

    expect(shortcuts.handleKeyDown(event)).toBe(true);
    expect(splitPanel).not.toHaveBeenCalled();
    expect(shortcuts.leaderActive).toBe(false);
    shortcuts.cleanup();
  });

  it('keeps a modified jump-to-panel trigger intact', () => {
    mocks.shortcutOverrides['leader.jump-to-panel'] = 'alt+x + 1-9';
    const shortcuts = createPanelKeyboardShortcuts(() => manager, undefined, undefined, {
      isMac: true,
    });
    shortcuts.activateLeader();

    expect(shortcuts.handleKeyDown(event('x', { altKey: true }))).toBe(true);
    expect(shortcuts.showPanelNumbers).toBe(true);
    expect(shortcuts.leaderActive).toBe(true);
    shortcuts.cleanup();
  });
});

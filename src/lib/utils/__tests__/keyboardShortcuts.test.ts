/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutManager } from '../keyboardShortcuts';

function dispatchShortcut(target: EventTarget, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const managers: KeyboardShortcutManager[] = [];

function createSpacesManager(action: () => void, modifier: 'meta' | 'ctrl') {
  const manager = new KeyboardShortcutManager();
  managers.push(manager);
  manager.register({
    key: 'o',
    [modifier]: true,
    description: 'Toggle All Spaces',
    action,
    skipInEditableElements: true,
  });
  manager.attach();
  return manager;
}

function createGlobalCloseManager(
  action: () => void,
  modifier: 'meta' | 'ctrl',
  workspaceAction?: () => void,
) {
  const manager = new KeyboardShortcutManager();
  managers.push(manager);
  manager.register({
    key: 'w',
    [modifier]: true,
    description: 'Close Panel Tab',
    action,
    global: true,
  });
  if (workspaceAction) {
    manager.register({
      key: 'w',
      [modifier]: true,
      shift: true,
      description: 'Close Space Tab',
      action: workspaceAction,
      global: true,
    });
  }
  manager.attach();
  return manager;
}

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  document.body.replaceChildren();
});

describe('spaces shortcut handling', () => {
  it.each([
    ['Cmd+O', 'input', 'meta', () => document.createElement('input')],
    [
      'Cmd+O',
      'contenteditable',
      'meta',
      () => {
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        editable.tabIndex = 0;
        return editable;
      },
    ],
    ['Ctrl+O', 'input', 'ctrl', () => document.createElement('input')],
    [
      'Ctrl+O',
      'contenteditable',
      'ctrl',
      () => {
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        editable.tabIndex = 0;
        return editable;
      },
    ],
  ] as const)(
    'leaves %s unhandled from %s focus',
    (_shortcut, _context, modifier, createTarget) => {
      const action = vi.fn();
      createSpacesManager(action, modifier);
      const target = createTarget();
      document.body.append(target);
      target.focus();
      const bubbled = vi.fn();
      document.addEventListener('keydown', bubbled, { once: true });

      const event = dispatchShortcut(target, {
        key: 'o',
        code: 'KeyO',
        metaKey: modifier === 'meta',
        ctrlKey: modifier === 'ctrl',
        shiftKey: false,
      });

      expect(document.activeElement).toBe(target);
      if (_context === 'input') expect(event.defaultPrevented).toBe(false);
      expect(bubbled).toHaveBeenCalledOnce();
      expect(action).not.toHaveBeenCalled();
    },
  );
});

describe('global panel-tab close shortcut handling', () => {
  it.each([
    ['Command+W', 'input', 'meta', () => document.createElement('input')],
    [
      'Command+W',
      'editor',
      'meta',
      () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        return editor;
      },
    ],
    ['Control+W', 'input', 'ctrl', () => document.createElement('input')],
    [
      'Control+W',
      'editor',
      'ctrl',
      () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        return editor;
      },
    ],
  ] as const)('handles %s from %s focus', (_shortcut, _context, modifier, createTarget) => {
    const action = vi.fn();
    createGlobalCloseManager(action, modifier);
    const target = createTarget();
    document.body.append(target);

    const event = dispatchShortcut(target, {
      key: 'w',
      code: 'KeyW',
      metaKey: modifier === 'meta',
      ctrlKey: modifier === 'ctrl',
      shiftKey: false,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it.each([
    ['Command', 'meta'],
    ['Control', 'ctrl'],
  ] as const)('keeps %s+W and its Shift chord exact and distinct', (_label, modifier) => {
    const panelAction = vi.fn();
    const workspaceAction = vi.fn();
    createGlobalCloseManager(panelAction, modifier, workspaceAction);
    const input = document.createElement('input');
    document.body.append(input);

    expect(
      dispatchShortcut(input, {
        key: 'w',
        code: 'KeyW',
        metaKey: modifier === 'meta',
        ctrlKey: modifier === 'ctrl',
        shiftKey: false,
      }).defaultPrevented,
    ).toBe(true);
    expect(panelAction).toHaveBeenCalledOnce();
    expect(workspaceAction).not.toHaveBeenCalled();

    expect(
      dispatchShortcut(input, {
        key: 'w',
        code: 'KeyW',
        metaKey: modifier === 'meta',
        ctrlKey: modifier === 'ctrl',
        shiftKey: true,
      }).defaultPrevented,
    ).toBe(true);
    expect(panelAction).toHaveBeenCalledOnce();
    expect(workspaceAction).toHaveBeenCalledOnce();
  });

  it.each([
    ['input', () => document.createElement('input')],
    [
      'editor',
      () => {
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        return editor;
      },
    ],
  ])('handles the global workspace close chord from %s focus', (_context, createTarget) => {
    const action = vi.fn();
    createGlobalCloseManager(vi.fn(), 'ctrl', action);
    const target = createTarget();
    document.body.append(target);

    const event = dispatchShortcut(target, {
      key: 'w',
      code: 'KeyW',
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });
});

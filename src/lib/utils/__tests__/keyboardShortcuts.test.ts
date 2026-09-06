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

describe('terminal-focused shortcut handling', () => {
  it('only fires shortcuts that opt in while preserving normal button behavior', () => {
    const blockedAction = vi.fn();
    const allowedAction = vi.fn();
    const manager = new KeyboardShortcutManager();
    managers.push(manager);
    manager.register({
      key: 'n',
      ctrl: true,
      alt: true,
      description: 'Blocked in terminal',
      action: blockedAction,
    });
    manager.register({
      key: 'b',
      ctrl: true,
      alt: true,
      description: 'Allowed in terminal',
      action: allowedAction,
      allowInTerminal: true,
    });
    manager.attach();
    const terminal = document.createElement('textarea');
    terminal.classList.add('xterm-helper-textarea');
    const button = document.createElement('button');
    document.body.append(terminal, button);

    const blockedTerminalEvent = dispatchShortcut(terminal, {
      key: 'n',
      code: 'KeyN',
      ctrlKey: true,
      altKey: true,
    });
    const allowedTerminalEvent = dispatchShortcut(terminal, {
      key: 'b',
      code: 'KeyB',
      ctrlKey: true,
      altKey: true,
    });

    expect(blockedTerminalEvent.defaultPrevented).toBe(false);
    expect(blockedAction).not.toHaveBeenCalled();
    expect(allowedTerminalEvent.defaultPrevented).toBe(true);
    expect(allowedAction).toHaveBeenCalledOnce();

    expect(
      dispatchShortcut(button, {
        key: 'n',
        code: 'KeyN',
        ctrlKey: true,
        altKey: true,
      }).defaultPrevented,
    ).toBe(true);
    expect(
      dispatchShortcut(button, {
        key: 'b',
        code: 'KeyB',
        ctrlKey: true,
        altKey: true,
      }).defaultPrevented,
    ).toBe(true);
    expect(blockedAction).toHaveBeenCalledOnce();
    expect(allowedAction).toHaveBeenCalledTimes(2);
  });
});

describe('effective shortcut bindings', () => {
  it('resolves a changed binding for every keydown without re-registering', () => {
    const action = vi.fn();
    let binding = 'ctrl+k';
    const manager = new KeyboardShortcutManager();
    managers.push(manager);
    manager.register({
      key: 'k',
      ctrl: true,
      binding: () => binding,
      description: 'Dynamic action',
      action,
    });
    manager.attach();

    dispatchShortcut(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    binding = 'ctrl+j';
    dispatchShortcut(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    dispatchShortcut(window, { key: 'j', code: 'KeyJ', ctrlKey: true });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('never handles app shortcuts from a shortcut settings input', () => {
    const action = vi.fn();
    const manager = new KeyboardShortcutManager();
    managers.push(manager);
    manager.register({
      key: 'w',
      ctrl: true,
      binding: () => 'ctrl+w',
      global: true,
      description: 'Dynamic action',
      action,
    });
    manager.attach();
    const input = document.createElement('input');
    input.dataset.shortcutInput = '';
    document.body.append(input);

    const event = dispatchShortcut(input, { key: 'w', code: 'KeyW', ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('does not treat a plain dynamic rebinding as globally modified inside an input', () => {
    const action = vi.fn();
    const manager = new KeyboardShortcutManager();
    managers.push(manager);
    manager.register({
      key: 'k',
      meta: true,
      binding: () => 'k',
      description: 'Dynamically rebound action',
      action,
    });
    manager.attach();
    const input = document.createElement('input');
    document.body.append(input);

    const event = dispatchShortcut(input, { key: 'k', code: 'KeyK' });

    expect(event.defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});

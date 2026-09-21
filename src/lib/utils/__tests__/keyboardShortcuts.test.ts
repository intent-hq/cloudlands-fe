/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpacesShortcut } from '$features/workspace/utils/spaces-shortcut';
import { KeyboardShortcutManager } from '../keyboardShortcuts';
import { SHORTCUT_DEFAULTS } from '../shortcut-bindings';

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

function createSpacesManager(action: () => void) {
  const manager = new KeyboardShortcutManager();
  managers.push(manager);
  manager.register(createSpacesShortcut(action, () => SHORTCUT_DEFAULTS['global.toggle-spaces']));
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
  vi.restoreAllMocks();
});

describe('spaces shortcut handling', () => {
  describe.each(['MacIntel', 'Win32', 'Linux x86_64'])('on %s', (platform) => {
    const isMac = platform === 'MacIntel';
    const chord = { key: 'o', code: 'KeyO', metaKey: isMac, ctrlKey: !isMac };

    beforeEach(() => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    });

    it.each(['input', 'textarea', 'contenteditable', 'nested contenteditable'])(
      'handles Mod+O from %s focus',
      (context) => {
        const action = vi.fn();
        createSpacesManager(action);
        const target = document.createElement(
          context.includes('contenteditable') ? 'div' : context,
        );
        if (context.includes('contenteditable')) {
          target.setAttribute('contenteditable', 'true');
          target.tabIndex = 0;
          target.append(document.createElement('span'));
        }
        document.body.append(target);
        target.focus();
        const bubbled = vi.fn();
        target.addEventListener('keydown', bubbled);

        const event = dispatchShortcut(
          context === 'nested contenteditable' ? target.firstElementChild! : target,
          chord,
        );

        expect(document.activeElement).toBe(target);
        expect(event.defaultPrevented).toBe(true);
        expect(bubbled).not.toHaveBeenCalled();
        expect(action).toHaveBeenCalledOnce();
      },
    );

    it.each(['terminal', 'shortcut recorder', 'plain O', 'Shift+Mod+O'])(
      'preserves the %s exclusion',
      (context) => {
        const action = vi.fn();
        createSpacesManager(action);
        const input = document.createElement('textarea');
        if (context === 'terminal') input.classList.add('xterm-helper-textarea');
        if (context === 'shortcut recorder') input.dataset.shortcutInput = '';
        document.body.append(input);
        input.focus();

        const event = dispatchShortcut(input, {
          ...chord,
          ...(context === 'plain O' ? { metaKey: false, ctrlKey: false } : {}),
          shiftKey: context === 'Shift+Mod+O',
        });

        expect(event.defaultPrevented).toBe(false);
        expect(action).not.toHaveBeenCalled();
      },
    );
  });
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

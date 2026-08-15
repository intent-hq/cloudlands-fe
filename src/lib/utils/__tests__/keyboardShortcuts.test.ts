/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutManager } from '../keyboardShortcuts';

function dispatchShortcut(target: EventTarget, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'l',
    code: 'KeyL',
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const managers: KeyboardShortcutManager[] = [];

function createWorkspaceViewManager(action: () => void, enabled = () => true) {
  const manager = new KeyboardShortcutManager();
  managers.push(manager);
  manager.register({
    key: 'l',
    meta: true,
    shift: true,
    description: 'Switch workspace view',
    action,
    enabled,
    ignoreRepeat: true,
  });
  manager.attach();
  return manager;
}

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

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  document.body.replaceChildren();
});

describe('workspace view shortcut handling', () => {
  it('uses exact modifiers and leaves disabled routes unhandled', () => {
    const action = vi.fn();
    let enabled = false;
    createWorkspaceViewManager(action, () => enabled);

    expect(dispatchShortcut(document.body).defaultPrevented).toBe(false);
    enabled = true;
    expect(dispatchShortcut(document.body, { altKey: true }).defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();

    expect(dispatchShortcut(document.body).defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    [
      'contenteditable',
      () => {
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        return editable;
      },
    ],
    [
      'composer',
      () => {
        const composer = document.createElement('div');
        composer.dataset.testid = 'message-input';
        const editor = document.createElement('div');
        editor.className = 'ProseMirror';
        editor.setAttribute('contenteditable', 'true');
        editor.setAttribute('role', 'textbox');
        composer.append(editor);
        return editor;
      },
    ],
  ])('toggles the workspace view from %s focus', (_context, createTarget) => {
    const action = vi.fn();
    createWorkspaceViewManager(action);
    const target = createTarget();
    document.body.append(target.closest('[data-testid="message-input"]') ?? target);

    expect(dispatchShortcut(target).defaultPrevented).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it('ignores held-key repeats', () => {
    const action = vi.fn();
    createWorkspaceViewManager(action);

    expect(dispatchShortcut(document.body, { repeat: true }).defaultPrevented).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('attaches once, cleans up, and does not duplicate after remount', () => {
    const firstAction = vi.fn();
    const first = createWorkspaceViewManager(firstAction);
    first.attach();
    dispatchShortcut(document.body);
    expect(firstAction).toHaveBeenCalledOnce();

    first.destroy();
    dispatchShortcut(document.body);
    expect(firstAction).toHaveBeenCalledOnce();

    const secondAction = vi.fn();
    createWorkspaceViewManager(secondAction);
    dispatchShortcut(document.body);
    expect(secondAction).toHaveBeenCalledOnce();
  });
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

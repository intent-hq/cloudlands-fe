/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppShortcutRegistrar } from './app-shortcut-registrar';
import { KeyboardShortcutManager, type KeyboardShortcut } from './keyboardShortcuts';
import { SHORTCUT_DEFAULTS, type ShortcutId } from './shortcut-bindings';
import { registerWorkspaceTabShortcuts } from '$features/workspace/utils/workspace-tab-navigation';

describe('createAppShortcutRegistrar', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.innerHTML = '';
  });

  it('forwards every option, including preferLocal and allowInTerminal', () => {
    const registered: KeyboardShortcut[] = [];
    const register = createAppShortcutRegistrar(
      { register: (shortcut) => registered.push(shortcut) },
      (id) => SHORTCUT_DEFAULTS[id],
    );
    const enabled = () => true;
    const action = vi.fn();

    register({
      key: '}',
      meta: true,
      shift: true,
      description: 'Next',
      action,
      enabled,
      global: true,
      preferLocal: true,
      allowInTerminal: true,
      ignoreRepeat: true,
      skipInEditableElements: false,
    });

    expect(registered).toEqual([
      {
        key: '}',
        meta: true,
        ctrl: false,
        shift: true,
        alt: false,
        description: 'Next',
        action,
        enabled,
        global: true,
        preferLocal: true,
        allowInTerminal: true,
        ignoreRepeat: true,
        skipInEditableElements: false,
        binding: undefined,
      },
    ]);
  });

  it('resolves a shortcutId to the effective binding at event time', () => {
    const registered: KeyboardShortcut[] = [];
    let binding = 'mod+g';
    const register = createAppShortcutRegistrar(
      { register: (shortcut) => registered.push(shortcut) },
      (id: ShortcutId) => (id === 'editor.go-to-line' ? binding : SHORTCUT_DEFAULTS[id]),
    );
    register({
      key: 'g',
      meta: true,
      shortcutId: 'editor.go-to-line',
      description: '',
      action() {},
    });

    expect(registered[0]).not.toHaveProperty('shortcutId');
    expect(registered[0].binding?.()).toBe('mod+g');
    binding = 'mod+alt+g';
    expect(registered[0].binding?.()).toBe('mod+alt+g');
  });

  it('lets allowInTerminal workspace shortcuts fire from a terminal (#2234)', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    const manager = new KeyboardShortcutManager();
    cleanups.push(() => {
      manager.destroy();
      platform.mockRestore();
    });
    const onCreateTerminal = vi.fn();
    const navigate = vi.fn();
    registerWorkspaceTabShortcuts({
      isMac: false,
      register: createAppShortcutRegistrar(manager, (id) => SHORTCUT_DEFAULTS[id]),
      store: {
        state: {
          tabState: { openTabs: {}, workspaceStacks: [], currentTabId: null },
        },
        dispatch: vi.fn(),
      } as never,
      getCurrentPath: () => '/workspace/ws-1',
      navigate,
      openNewWorkspace: vi.fn(),
      onCreateTerminal,
      resolveBinding: (id) => SHORTCUT_DEFAULTS[id],
    });
    manager.attach();

    const terminal = document.createElement('textarea');
    terminal.className = 'xterm-helper-textarea';
    document.body.appendChild(terminal);
    const event = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminal.dispatchEvent(event);

    expect(onCreateTerminal).toHaveBeenCalledWith('ws-1');
    expect(event.defaultPrevented).toBe(true);
  });
});

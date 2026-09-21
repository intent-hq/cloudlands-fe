/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutManager } from '../keyboardShortcuts';
import { registerGlobalSearchShortcuts } from '../global-search-shortcuts';
import { resolveShortcut, type ShortcutOverrides } from '../shortcut-bindings';

describe.each([
  ['macOS', 'MacIntel', { metaKey: true, ctrlKey: false }],
  ['Windows/Linux', 'Win32', { metaKey: false, ctrlKey: true }],
] as const)('local find before global search on %s', (_label, platform, mod) => {
  let manager: KeyboardShortcutManager;
  let overrides: ShortcutOverrides;
  const openGlobalSearch = vi.fn();
  const localListeners: Array<() => void> = [];

  function press(init: KeyboardEventInit = {}, target: EventTarget = window) {
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      ...mod,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  function listen(target: EventTarget, handler: (event: KeyboardEvent) => void) {
    target.addEventListener('keydown', handler as EventListener);
    localListeners.push(() => target.removeEventListener('keydown', handler as EventListener));
  }

  beforeEach(() => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    overrides = {};
    openGlobalSearch.mockClear();
    manager = new KeyboardShortcutManager();
    registerGlobalSearchShortcuts(manager, {
      isMac: platform === 'MacIntel',
      resolveBinding: () => resolveShortcut('global.search', overrides),
      openSearch: openGlobalSearch,
    });
    manager.attach();
  });

  afterEach(() => {
    manager.destroy();
    for (const remove of localListeners.splice(0)) remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('lets a later-mounted window handler claim find before the palette opens', () => {
    expect(press().defaultPrevented).toBe(true);
    expect(openGlobalSearch).toHaveBeenCalledOnce();
    openGlobalSearch.mockClear();
    const localFind = vi.fn((event: KeyboardEvent) => event.preventDefault());
    listen(window, localFind);

    expect(press().defaultPrevented).toBe(true);
    expect(localFind).toHaveBeenCalledOnce();
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });

  it('runs the global fallback synchronously when local panels decline the event', () => {
    const panel = vi.fn();
    listen(window, panel);
    expect(press().defaultPrevented).toBe(true);
    expect(panel).toHaveBeenCalledOnce();
    expect(openGlobalSearch).toHaveBeenCalledOnce();
  });

  it('preserves editor-owned find even when it stops propagation before window', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    const find = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    listen(editor, find);

    expect(press({}, editor).defaultPrevented).toBe(true);
    expect(find).toHaveBeenCalledOnce();
    expect(openGlobalSearch).not.toHaveBeenCalled();
    expect(press().defaultPrevented).toBe(true);
    expect(openGlobalSearch).toHaveBeenCalledOnce();
  });

  it('leaves terminal find with the terminal rather than the global fallback', () => {
    const terminal = document.createElement('textarea');
    terminal.classList.add('xterm-helper-textarea');
    document.body.append(terminal);
    const find = vi.fn((event: KeyboardEvent) => event.preventDefault());
    listen(terminal, find);

    press({}, terminal);
    expect(find).toHaveBeenCalledOnce();
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });

  it('keeps extra modifiers and the other platform modifier out of plain find', () => {
    for (const init of [
      { altKey: true },
      { metaKey: true, ctrlKey: true },
      { metaKey: !mod.metaKey, ctrlKey: !mod.ctrlKey },
    ]) {
      expect(press(init).defaultPrevented).toBe(false);
    }
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });

  it('keeps Mod+Shift+F global even while a panel could handle plain find', () => {
    const local = vi.fn((event: KeyboardEvent) => event.preventDefault());
    listen(document, local);
    expect(press({ shiftKey: true }, document.body).defaultPrevented).toBe(true);
    expect(openGlobalSearch).toHaveBeenCalledOnce();
    expect(local).not.toHaveBeenCalled();
  });

  it('resolves a user rebind at event time and keeps ordinary palette shortcuts in capture', () => {
    const palette = vi.fn();
    manager.register({
      key: 'k',
      binding: () => resolveShortcut('global.command-palette-alt', overrides),
      description: 'Palette',
      action: palette,
    });
    const local = vi.fn((event: KeyboardEvent) => event.preventDefault());
    listen(window, local);
    press({ key: 'k', code: 'KeyK' }, document.body);
    expect(palette).toHaveBeenCalledOnce();
    expect(local).not.toHaveBeenCalled();

    localListeners.pop()?.();
    overrides = { 'global.search': 'mod+alt+s' };
    expect(press().defaultPrevented).toBe(false);
    expect(press({ key: 's', code: 'KeyS', altKey: true }).defaultPrevented).toBe(true);
    expect(openGlobalSearch).toHaveBeenCalledOnce();
  });

  it('removes its fallback listener when disabled', () => {
    press();
    openGlobalSearch.mockClear();
    manager.detach();
    expect(press().defaultPrevented).toBe(false);
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });
});

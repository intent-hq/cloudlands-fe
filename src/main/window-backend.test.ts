import { EventEmitter } from 'node:events';
import type { BrowserWindow as WindowType, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
import {
  bindViewToBackend,
  getBackendIdForWebContents,
  getStrictBackendBindingForWebContents,
  getViewBinding,
  stampWindowWithBackend,
  unbindView,
  UNIFIED_SHELL_BACKEND_ID,
} from './window-backend';

function makeWindow() {
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  windows.set(sender, window);
  return { window: window as unknown as WindowType, sender: sender as unknown as WebContents };
}

describe('strict window backend documents', () => {
  it('does not inherit legacy local fallback or another window binding', () => {
    const a = makeWindow();
    const b = makeWindow();
    stampWindowWithBackend(a.window, 'host-A');
    expect(getStrictBackendBindingForWebContents(a.sender)?.backendId).toBe('host-A');
    expect(getStrictBackendBindingForWebContents(b.sender)).toBeNull();
    expect(getBackendIdForWebContents(b.sender)).toBe('local');
    stampWindowWithBackend(b.window, 'local');
    expect(getStrictBackendBindingForWebContents(b.sender)?.backendId).toBe('local');
    expect(getStrictBackendBindingForWebContents(a.sender)?.stamp).not.toBe(
      getStrictBackendBindingForWebContents(b.sender)?.stamp,
    );
  });
  it('never reuses a stamp through A to B to A or same-backend rebinding', () => {
    const { window, sender } = makeWindow();
    stampWindowWithBackend(window, 'A');
    const initial = getStrictBackendBindingForWebContents(sender);
    stampWindowWithBackend(window, 'B');
    stampWindowWithBackend(window, 'A');
    expect(getStrictBackendBindingForWebContents(sender)?.stamp).not.toBe(initial?.stamp);
    const current = getStrictBackendBindingForWebContents(sender);
    stampWindowWithBackend(window, 'A');
    expect(getStrictBackendBindingForWebContents(sender)?.stamp).not.toBe(current?.stamp);
  });
  it('retires for full main navigation and activates a fresh document only after ready', () => {
    const { window, sender } = makeWindow();
    stampWindowWithBackend(window, 'A');
    const initial = getStrictBackendBindingForWebContents(sender);
    sender.emit('did-start-navigation', {}, 'app://next', false, false);
    expect(getStrictBackendBindingForWebContents(sender)).toBe(initial);
    sender.emit('did-start-navigation', {}, 'app://next#hash', true, true);
    expect(getStrictBackendBindingForWebContents(sender)).toBe(initial);
    sender.emit('did-start-navigation', {}, 'app://next', false, true);
    expect(getStrictBackendBindingForWebContents(sender)).toBeNull();
    sender.emit('dom-ready');
    expect(getStrictBackendBindingForWebContents(sender)?.stamp).not.toBe(initial?.stamp);
    expect(getStrictBackendBindingForWebContents(sender)?.backendId).toBe('A');
  });
  it.each(['render-process-gone', 'destroyed'])('retires on %s', (event) => {
    const { window, sender } = makeWindow();
    stampWindowWithBackend(window, 'A');
    sender.emit(event);
    expect(getStrictBackendBindingForWebContents(sender)).toBeNull();
  });
  it('retires on closure, replaced frame, replaced contents, or lost window mapping', () => {
    for (const retire of [
      ({ window }: ReturnType<typeof makeWindow>) => window.emit('closed'),
      ({ sender }: ReturnType<typeof makeWindow>) => Object.assign(sender, { mainFrame: {} }),
      ({ window }: ReturnType<typeof makeWindow>) => Object.assign(window, { webContents: {} }),
      ({ sender }: ReturnType<typeof makeWindow>) => windows.delete(sender),
    ]) {
      const pair = makeWindow();
      stampWindowWithBackend(pair.window, 'A');
      retire(pair);
      expect(getStrictBackendBindingForWebContents(pair.sender)).toBeNull();
    }
  });
});

describe('Unified window machine views', () => {
  function makeView(host: WindowType, hostedBy: 'host' | 'none' = 'host') {
    const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
    // A view's contents resolve to the host window (or, defensively, to nothing).
    if (hostedBy === 'host') windows.set(sender, host);
    return sender as unknown as WebContents;
  }

  it('resolves a view to its own machine, never to the shell or local', () => {
    const shell = makeWindow();
    stampWindowWithBackend(shell.window, UNIFIED_SHELL_BACKEND_ID);
    const studio = makeView(shell.window);
    const local = makeView(shell.window);
    bindViewToBackend(studio, shell.window, 'studio');
    bindViewToBackend(local, shell.window, 'local');

    expect(getBackendIdForWebContents(studio)).toBe('studio');
    expect(getBackendIdForWebContents(local)).toBe('local');
    expect(getStrictBackendBindingForWebContents(studio)?.backendId).toBe('studio');
    expect(getStrictBackendBindingForWebContents(studio)?.window).toBe(shell.window);
  });

  it('refuses the shell: it resolves to an id no backend client serves', () => {
    const shell = makeWindow();
    stampWindowWithBackend(shell.window, UNIFIED_SHELL_BACKEND_ID);
    expect(getBackendIdForWebContents(shell.sender)).toBe(UNIFIED_SHELL_BACKEND_ID);
    expect(getBackendIdForWebContents(shell.sender)).not.toBe('local');
  });

  it('refuses a view once unbound, even when Electron maps it to no window', () => {
    const shell = makeWindow();
    stampWindowWithBackend(shell.window, UNIFIED_SHELL_BACKEND_ID);
    const orphan = makeView(shell.window, 'none');
    bindViewToBackend(orphan, shell.window, 'studio');
    unbindView(orphan);
    expect(getBackendIdForWebContents(orphan)).toBe(UNIFIED_SHELL_BACKEND_ID);
    expect(getStrictBackendBindingForWebContents(orphan)).toBeNull();
  });

  it('retires a view binding on navigation and rebinds the new document to the same machine', () => {
    const shell = makeWindow();
    const view = makeView(shell.window);
    bindViewToBackend(view, shell.window, 'studio');
    const initial = getStrictBackendBindingForWebContents(view);
    (view as unknown as EventEmitter).emit('did-start-navigation', {}, 'app://x', false, true);
    expect(getStrictBackendBindingForWebContents(view)).toBeNull();
    (view as unknown as EventEmitter).emit('dom-ready');
    expect(getStrictBackendBindingForWebContents(view)?.stamp).not.toBe(initial?.stamp);
    expect(getStrictBackendBindingForWebContents(view)?.backendId).toBe('studio');
  });

  it('drops a destroyed view from the binding and the push targets', () => {
    const shell = makeWindow();
    const view = makeView(shell.window);
    bindViewToBackend(view, shell.window, 'studio');
    expect(getViewBinding(view)?.backendId).toBe('studio');
    (view as unknown as EventEmitter).emit('destroyed');
    expect(getViewBinding(view)).toBeNull();
    expect(getStrictBackendBindingForWebContents(view)).toBeNull();
  });
});

import { EventEmitter } from 'node:events';
import type { BrowserWindow as WindowType, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';

const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
import {
  getBackendIdForWebContents,
  getStrictBackendBindingForWebContents,
  stampWindowWithBackend,
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

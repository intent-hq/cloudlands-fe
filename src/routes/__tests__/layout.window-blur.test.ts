import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: () => () => {},
}));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/history-navigation', () => ({
  attachMouseHistoryNavigation: () => () => {},
  handleHistoryNavigateIpc: () => {},
}));
import { store as appStore } from '$store/renderer/store';
import RootLayout from '../+layout.svelte';

describe('root +layout.svelte window focus lifecycle', () => {
  const originalElectronApi = window.electronAPI;

  beforeEach(() => {
    appStore.init();
    delete (window as Partial<Window>).electronAPI;
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    document.documentElement.removeAttribute('data-window-blurred');
    window.electronAPI = originalElectronApi;
    vi.restoreAllMocks();
  });

  it('uses DOM focus events as a fallback and removes its listeners on destroy', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const view = render(RootLayout);

    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(true);
    window.dispatchEvent(new FocusEvent('focus'));
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(true);

    view.unmount();
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);
  });

  it('uses DOM focus events when the production browser mock is installed', async () => {
    vi.stubEnv('VITE_ENABLE_BROWSER_MOCK', 'true');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { installBrowserMock } = await import('$lib/browser-mock');
    installBrowserMock();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    render(RootLayout);

    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(true);
    window.dispatchEvent(new FocusEvent('focus'));
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);
  });

  it('uses native window focus events when the Electron bridge is present', () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const on = vi.fn((channel: string, callback: (...args: any[]) => void) => {
      listeners[channel] = callback;
      return `listener:${channel}`;
    });
    const offById = vi.fn();
    window.electronAPI = { on, offById } as ElectronAPI;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    const view = render(RootLayout);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);

    listeners['window:focus'](false);
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(true);
    listeners['window:focus'](true);
    expect(document.documentElement.hasAttribute('data-window-blurred')).toBe(false);

    view.unmount();
    expect(offById).toHaveBeenCalledWith('window:focus', 'listener:window:focus');
  });
});

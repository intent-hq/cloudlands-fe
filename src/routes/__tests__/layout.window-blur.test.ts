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
  beforeEach(() => appStore.init());

  afterEach(() => {
    cleanup();
    appStore.dispose();
    document.documentElement.removeAttribute('data-window-blurred');
    vi.restoreAllMocks();
  });

  it('tracks initial focus and removes its listeners on destroy', () => {
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
});

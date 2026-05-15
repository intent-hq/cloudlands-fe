import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createEmbeddedBrowserNavigationSyncState,
  reconcileEmbeddedBrowserUrlProp,
  recordEmbeddedBrowserNavigation,
} from './embedded-browser-navigation-sync';

describe('embedded browser navigation synchronization', () => {
  it('syncs in-page SPA navigation without requesting a redundant load', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/app/settings');
    const decision = reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/settings', {
      webviewReady: true,
      isValidBrowserUrl,
    });

    expect(syncState.previousUrlProp).toBe('https://example.test/app/settings');
    expect(decision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(isValidBrowserUrl).not.toHaveBeenCalled();
  });

  it('still navigates intentional external URL prop changes', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    const decision = reconcileEmbeddedBrowserUrlProp(syncState, 'https://docs.example.test/', {
      webviewReady: true,
      isValidBrowserUrl,
    });

    expect(syncState.previousUrlProp).toBe('https://docs.example.test/');
    expect(decision).toEqual({ shouldLoad: true, targetUrl: 'https://docs.example.test/' });
    expect(isValidBrowserUrl).toHaveBeenCalledWith('https://docs.example.test/');
  });

  it('does not treat a stale navigation event as the latest prop when the latest prop is reconciled', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    expect(
      reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/settings', {
        webviewReady: true,
        isValidBrowserUrl,
      }),
    ).toEqual({ shouldLoad: true, targetUrl: 'https://example.test/app/settings' });
    expect(
      reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/profile', {
        webviewReady: true,
        isValidBrowserUrl,
      }),
    ).toEqual({ shouldLoad: true, targetUrl: 'https://example.test/app/profile' });

    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/app/settings');
    const decision = reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/profile', {
      webviewReady: true,
      isValidBrowserUrl,
    });

    expect(decision).toEqual({ shouldLoad: true, targetUrl: 'https://example.test/app/profile' });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/profile');
  });

  it('records URL prop changes while the webview is not ready and does not load the same prop later', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    const notReadyDecision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/settings',
      {
        webviewReady: false,
        isValidBrowserUrl,
      },
    );
    const readyDecision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/settings',
      {
        webviewReady: true,
        isValidBrowserUrl,
      },
    );

    expect(notReadyDecision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(readyDecision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(isValidBrowserUrl).not.toHaveBeenCalled();
  });

  it('uses exact string equality for equivalent parent URL round-trips', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/app');
    const decision = reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/', {
      webviewReady: true,
      isValidBrowserUrl,
    });

    expect(decision).toEqual({ shouldLoad: true, targetUrl: 'https://example.test/app/' });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/');
    expect(isValidBrowserUrl).toHaveBeenCalledWith('https://example.test/app/');
  });

  it('syncs generic did-navigate history events without requesting a redundant load', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app/profile');
    const isValidBrowserUrl = vi.fn(() => true);

    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/app/settings');
    const decision = reconcileEmbeddedBrowserUrlProp(syncState, 'https://example.test/app/settings', {
      webviewReady: true,
      isValidBrowserUrl,
    });

    expect(decision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/settings');
    expect(isValidBrowserUrl).not.toHaveBeenCalled();
  });
});
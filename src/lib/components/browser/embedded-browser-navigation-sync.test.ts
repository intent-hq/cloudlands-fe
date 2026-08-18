import { describe, expect, it, vi } from 'vitest';
import {
  createEmbeddedBrowserNavigationSyncState,
  navigateEmbeddedBrowserWebview,
  reconcileEmbeddedBrowserLoadCompletion,
  reconcileEmbeddedBrowserUrlProp,
  recordEmbeddedBrowserNavigation,
} from './embedded-browser-navigation-sync';

describe('embedded browser navigation synchronization', () => {
  it('navigates through loadURL so Electron emits did-navigate', async () => {
    const loadURL = vi.fn().mockResolvedValue(undefined);

    await navigateEmbeddedBrowserWebview({ loadURL }, 'https://example.test/next');

    expect(loadURL).toHaveBeenCalledWith('https://example.test/next');
  });

  it('records load completion when Electron omits did-navigate', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/start');

    expect(
      reconcileEmbeddedBrowserLoadCompletion(
        syncState,
        'https://example.test/requested',
        'https://example.test/final',
      ),
    ).toBe('https://example.test/final');
    expect(syncState.previousUrlProp).toBe('https://example.test/final');
  });

  it('does not duplicate a navigation event during load completion', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/start');
    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/final');

    expect(
      reconcileEmbeddedBrowserLoadCompletion(
        syncState,
        'https://example.test/requested',
        'https://example.test/final',
      ),
    ).toBeNull();
  });

  it('syncs in-page SPA navigation without requesting a redundant load', () => {
    const syncState = createEmbeddedBrowserNavigationSyncState('https://example.test/app');
    const isValidBrowserUrl = vi.fn(() => true);

    recordEmbeddedBrowserNavigation(syncState, 'https://example.test/app/settings');
    const decision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/settings',
      {
        webviewReady: true,
        isValidBrowserUrl,
      },
    );

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
    const decision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/profile',
      {
        webviewReady: true,
        isValidBrowserUrl,
      },
    );

    expect(decision).toEqual({ shouldLoad: true, targetUrl: 'https://example.test/app/profile' });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/profile');
  });

  it('defers URL prop changes while the webview is not ready and loads them once it is', () => {
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
    // The not-ready reconcile must not consume the prop change: the store
    // already points at the new URL (e.g. a restart-rehydrated tab whose
    // fresh tunnel resolves during the dead initial load, monorepo#2789), so
    // the readiness flip has to pick it up.
    expect(notReadyDecision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(syncState.previousUrlProp).toBe('https://example.test/app');

    const readyDecision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/settings',
      {
        webviewReady: true,
        isValidBrowserUrl,
      },
    );
    expect(readyDecision).toEqual({
      shouldLoad: true,
      targetUrl: 'https://example.test/app/settings',
    });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/settings');
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
    const decision = reconcileEmbeddedBrowserUrlProp(
      syncState,
      'https://example.test/app/settings',
      {
        webviewReady: true,
        isValidBrowserUrl,
      },
    );

    expect(decision).toEqual({ shouldLoad: false, targetUrl: null });
    expect(syncState.previousUrlProp).toBe('https://example.test/app/settings');
    expect(isValidBrowserUrl).not.toHaveBeenCalled();
  });
});

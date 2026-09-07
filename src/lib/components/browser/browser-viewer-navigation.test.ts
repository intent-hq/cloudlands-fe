import { describe, expect, it } from 'vitest';
import {
  completeViewerFollow,
  createViewerNavigationState,
  reconcileViewerCanonicalUrl,
  recordViewerNavigation,
} from './browser-viewer-navigation';

const valid = (url: string) => url.startsWith('https://');
const ready = { webviewReady: true, isValidBrowserUrl: valid };
const notReady = { webviewReady: false, isValidBrowserUrl: valid };

describe('viewer (mirror) navigation loop guard — REV-2 Model 3', () => {
  it('records the initial canonical URL as shown without loading it again', () => {
    const state = createViewerNavigationState();
    expect(reconcileViewerCanonicalUrl(state, 'https://a/', notReady)).toEqual({
      shouldLoad: false,
      targetUrl: null,
    });
    expect(recordViewerNavigation(state, 'https://a/')).toEqual({ forward: false });
  });

  it('follows a host-driven canonical change and does not forward the resulting navigation', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', ready);

    expect(reconcileViewerCanonicalUrl(state, 'https://b/', ready)).toEqual({
      shouldLoad: true,
      targetUrl: 'https://b/',
    });
    expect(recordViewerNavigation(state, 'https://b/')).toEqual({ forward: false });
    completeViewerFollow(state);
    expect(reconcileViewerCanonicalUrl(state, 'https://b/', ready).shouldLoad).toBe(false);
  });

  it('forwards a mirror-initiated navigation once and stops when the host echoes it back', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', ready);

    expect(recordViewerNavigation(state, 'https://c/')).toEqual({ forward: true });
    expect(reconcileViewerCanonicalUrl(state, 'https://c/', ready)).toEqual({
      shouldLoad: false,
      targetUrl: null,
    });
    expect(recordViewerNavigation(state, 'https://c/')).toEqual({ forward: false });
  });

  it('does not forward redirects that happen while a follow-load is in flight', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', ready);
    reconcileViewerCanonicalUrl(state, 'https://b', ready);

    expect(recordViewerNavigation(state, 'https://b')).toEqual({ forward: false });
    expect(recordViewerNavigation(state, 'https://b/')).toEqual({ forward: false });
    completeViewerFollow(state);
    expect(reconcileViewerCanonicalUrl(state, 'https://b', ready).shouldLoad).toBe(false);
  });

  it('forwards a navigation the user makes after a follow-load settled', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', ready);
    reconcileViewerCanonicalUrl(state, 'https://b/', ready);
    recordViewerNavigation(state, 'https://b/');
    completeViewerFollow(state);

    expect(recordViewerNavigation(state, 'https://d/')).toEqual({ forward: true });
  });

  it('defers a canonical change until the webview is ready, then loads it', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', notReady);

    expect(reconcileViewerCanonicalUrl(state, 'https://b/', notReady).shouldLoad).toBe(false);
    expect(reconcileViewerCanonicalUrl(state, 'https://b/', ready)).toEqual({
      shouldLoad: true,
      targetUrl: 'https://b/',
    });
  });

  it('skips a canonical URL the mirror is not allowed to load', () => {
    const state = createViewerNavigationState();
    reconcileViewerCanonicalUrl(state, 'https://a/', ready);

    expect(reconcileViewerCanonicalUrl(state, 'file:///etc/passwd', ready).shouldLoad).toBe(false);
    expect(state.following).toBe(false);
  });

  it('ignores an empty canonical URL', () => {
    const state = createViewerNavigationState();
    expect(reconcileViewerCanonicalUrl(state, '', ready).shouldLoad).toBe(false);
    expect(state.appliedCanonicalUrl).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RESOLVE_URL_CHANNEL,
  createEmbeddedBrowserResolvedLoadState,
  getEmbeddedBrowserExternalUrl,
  mapEmbeddedBrowserNavigationUrl,
  planEmbeddedBrowserLoad,
  recordEmbeddedBrowserResolvedLoad,
  reconcileEmbeddedBrowserNavigation,
  resolveEmbeddedBrowserUrl,
  type EmbeddedBrowserResolvedUrl,
} from './embedded-browser-url-resolution';

describe('resolveEmbeddedBrowserUrl', () => {
  it('sends the URL over browser:resolve-url and returns the resolved payload', async () => {
    const resolved: EmbeddedBrowserResolvedUrl = {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
      requestedUrl: 'http://localhost:3000/app',
      reason: 'daemon runs on a remote machine',
    };
    const invoke = vi.fn().mockResolvedValue(resolved);

    const result = await resolveEmbeddedBrowserUrl('http://localhost:3000/app', invoke);

    expect(invoke).toHaveBeenCalledWith(BROWSER_RESOLVE_URL_CHANNEL, {
      url: 'http://localhost:3000/app',
    });
    expect(result).toEqual(resolved);
  });

  it('passes through without a bridge (web builds)', async () => {
    const result = await resolveEmbeddedBrowserUrl('http://localhost:3000/', undefined);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });

  it('passes through when the invoke rejects', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('no handler'));
    const result = await resolveEmbeddedBrowserUrl('http://localhost:3000/', invoke);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });

  it('passes through on a malformed response', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false });
    const result = await resolveEmbeddedBrowserUrl('http://localhost:3000/', invoke);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });
});

describe('planEmbeddedBrowserLoad', () => {
  it('loads the resolved URL on success', () => {
    expect(
      planEmbeddedBrowserLoad({ url: 'http://10.0.0.5:3000/', rewritten: true }),
    ).toEqual({ kind: 'load', url: 'http://10.0.0.5:3000/' });
  });

  it('surfaces the error when a rewritten target is unreachable', () => {
    expect(
      planEmbeddedBrowserLoad({
        url: 'http://10.0.0.5:3000/',
        rewritten: true,
        error: 'not reachable from this machine',
      }),
    ).toEqual({ kind: 'error', detail: 'not reachable from this machine' });
  });

  it('still loads a passthrough URL even when an error is present', () => {
    expect(
      planEmbeddedBrowserLoad({
        url: 'http://localhost:3000/',
        rewritten: false,
        error: 'irrelevant',
      }),
    ).toEqual({ kind: 'load', url: 'http://localhost:3000/' });
  });
});

describe('resolved-load display mapping', () => {
  it('maps the resolved URL back to the requested URL for the current load', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
      requestedUrl: 'http://localhost:3000/app',
    });

    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
    // Mapping is stable across repeated events for the same load (reload).
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
  });

  it('normalizes URL variants when matching the resolved URL', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000', {
      url: 'http://10.0.0.5:3000',
      rewritten: true,
    });

    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/')).toBe(
      'http://localhost:3000',
    );
  });

  it('clears the mapping when the webview navigates elsewhere after commit', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    // The load commits, then the user clicks a link.
    reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/app');
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/other')).toBe(
      'http://10.0.0.5:3000/other',
    );
    // Once cleared, even the original resolved URL displays as-is.
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://10.0.0.5:3000/app',
    );
  });

  it('does not let a stale event from a superseded load clear an uncommitted mapping', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    // Load A commits...
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/a', {
      url: 'http://10.0.0.5:3000/a',
      rewritten: true,
    });
    reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/a');
    // ...then load B records its mapping, and A's queued event arrives late.
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/b', {
      url: 'http://10.0.0.5:3000/b',
      rewritten: true,
    });
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/a')).toBe(
      'http://10.0.0.5:3000/a',
    );
    // B's own commit still maps to its requested URL.
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/b')).toBe(
      'http://localhost:3000/b',
    );
  });

  it('does not clear the mapping for about:blank', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    expect(reconcileEmbeddedBrowserNavigation(state, 'about:blank')).toBe('about:blank');
    expect(reconcileEmbeddedBrowserNavigation(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
  });

  it('records no mapping for non-rewritten resolutions', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'https://example.com/', {
      url: 'https://example.com/',
      rewritten: false,
    });

    expect(state.requestedUrl).toBeNull();
    expect(reconcileEmbeddedBrowserNavigation(state, 'https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('mapEmbeddedBrowserNavigationUrl is pure - read-only callers never mutate the mapping', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    // A non-matching read does NOT clear the mapping.
    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/other')).toBe(
      'http://10.0.0.5:3000/other',
    );
    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
    expect(state.requestedUrl).toBe('http://localhost:3000/app');
  });
});

describe('getEmbeddedBrowserExternalUrl', () => {
  it('returns the resolved URL when the display URL is the requested URL of a rewritten load', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    expect(getEmbeddedBrowserExternalUrl(state, 'http://localhost:3000/app')).toBe(
      'http://10.0.0.5:3000/app',
    );
  });

  it('normalizes URL variants when matching the requested URL', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000', {
      url: 'http://10.0.0.5:3000',
      rewritten: true,
    });

    expect(getEmbeddedBrowserExternalUrl(state, 'http://localhost:3000/')).toBe(
      'http://10.0.0.5:3000',
    );
  });

  it('returns the display URL unchanged when no mapping is active', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    expect(getEmbeddedBrowserExternalUrl(state, 'https://example.com/')).toBe(
      'https://example.com/',
    );
  });

  it('returns the display URL unchanged when it differs from the requested URL', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    expect(getEmbeddedBrowserExternalUrl(state, 'http://localhost:3000/other')).toBe(
      'http://localhost:3000/other',
    );
  });
});

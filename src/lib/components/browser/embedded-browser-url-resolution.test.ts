import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RESOLVE_URL_CHANNEL,
  createEmbeddedBrowserResolvedLoadState,
  mapEmbeddedBrowserNavigationUrl,
  planEmbeddedBrowserLoad,
  recordEmbeddedBrowserResolvedLoad,
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

    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
    // Mapping is stable across repeated events for the same load (reload).
    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://localhost:3000/app',
    );
  });

  it('normalizes URL variants when matching the resolved URL', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000', {
      url: 'http://10.0.0.5:3000',
      rewritten: true,
    });

    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/')).toBe(
      'http://localhost:3000',
    );
  });

  it('clears the mapping when the webview navigates elsewhere', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/other')).toBe(
      'http://10.0.0.5:3000/other',
    );
    // Once cleared, even the original resolved URL displays as-is.
    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/app')).toBe(
      'http://10.0.0.5:3000/app',
    );
  });

  it('does not clear the mapping for about:blank', () => {
    const state = createEmbeddedBrowserResolvedLoadState();
    recordEmbeddedBrowserResolvedLoad(state, 'http://localhost:3000/app', {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
    });

    expect(mapEmbeddedBrowserNavigationUrl(state, 'about:blank')).toBe('about:blank');
    expect(mapEmbeddedBrowserNavigationUrl(state, 'http://10.0.0.5:3000/app')).toBe(
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
    expect(mapEmbeddedBrowserNavigationUrl(state, 'https://example.com/')).toBe(
      'https://example.com/',
    );
  });
});

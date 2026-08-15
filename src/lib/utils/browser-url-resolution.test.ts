import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RESOLVE_URL_CHANNEL,
  resolveBrowserLinkUrl,
  rewriteBrowserLinkForDisplay,
  type ResolvedBrowserLink,
} from './browser-url-resolution';

describe('resolveBrowserLinkUrl', () => {
  it('sends the URL over browser:resolve-url and returns the resolved payload', async () => {
    const resolved: ResolvedBrowserLink = {
      url: 'http://10.0.0.5:3000/app',
      rewritten: true,
      requestedUrl: 'http://localhost:3000/app',
      reason: 'daemon runs on a remote machine',
    };
    const invoke = vi.fn().mockResolvedValue(resolved);

    const result = await resolveBrowserLinkUrl('http://localhost:3000/app', invoke);

    expect(invoke).toHaveBeenCalledWith(BROWSER_RESOLVE_URL_CHANNEL, {
      url: 'http://localhost:3000/app',
    });
    expect(result).toEqual(resolved);
  });

  it('passes through without a bridge (web builds)', async () => {
    const result = await resolveBrowserLinkUrl('http://localhost:3000/', undefined);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });

  it('passes through when the invoke rejects', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('no handler'));
    const result = await resolveBrowserLinkUrl('http://localhost:3000/', invoke);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });

  it('passes through on a malformed response', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: false });
    const result = await resolveBrowserLinkUrl('http://localhost:3000/', invoke);
    expect(result).toEqual({ url: 'http://localhost:3000/', rewritten: false });
  });

  it('carries the error alongside the rewritten URL (caller toasts, still opens)', async () => {
    const invoke = vi.fn().mockResolvedValue({
      url: 'http://10.0.0.5:3000/',
      rewritten: true,
      error: 'not reachable from this machine',
    });
    const result = await resolveBrowserLinkUrl('http://localhost:3000/', invoke);
    expect(result.url).toBe('http://10.0.0.5:3000/');
    expect(result.error).toBe('not reachable from this machine');
  });
});

describe('rewriteBrowserLinkForDisplay', () => {
  it('requests rewrite-only mode and returns the rewritten URL', async () => {
    const invoke = vi.fn().mockResolvedValue({ url: 'http://10.0.0.5:8742/', rewritten: true });

    const result = await rewriteBrowserLinkForDisplay('http://127.0.0.1:8742/', invoke);

    expect(invoke).toHaveBeenCalledWith(BROWSER_RESOLVE_URL_CHANNEL, {
      url: 'http://127.0.0.1:8742/',
      mode: 'rewrite-only',
    });
    expect(result).toBe('http://10.0.0.5:8742/');
  });

  it('returns the input URL without a bridge', async () => {
    expect(await rewriteBrowserLinkForDisplay('http://127.0.0.1:8742/', undefined)).toBe(
      'http://127.0.0.1:8742/',
    );
  });

  it('returns the input URL when the invoke rejects', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('no handler'));
    expect(await rewriteBrowserLinkForDisplay('http://127.0.0.1:8742/', invoke)).toBe(
      'http://127.0.0.1:8742/',
    );
  });

  it('returns the input URL on a malformed response', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    expect(await rewriteBrowserLinkForDisplay('http://127.0.0.1:8742/', invoke)).toBe(
      'http://127.0.0.1:8742/',
    );
  });
});

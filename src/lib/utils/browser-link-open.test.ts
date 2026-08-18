import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError, warning: mocks.toastWarning },
}));

import { resolveBrowserLinkForOpen } from './browser-link-open';

describe('resolveBrowserLinkForOpen', () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn();
    vi.stubGlobal('window', { electronAPI: { invoke } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resolves through browser:resolve-url and returns the resolved URL', async () => {
    invoke.mockResolvedValue({ url: 'http://10.0.0.5:3000/app', rewritten: true });

    const resolved = await resolveBrowserLinkForOpen('http://localhost:3000/app');

    expect(invoke).toHaveBeenCalledWith('browser:resolve-url', {
      url: 'http://localhost:3000/app',
    });
    expect(resolved.url).toBe('http://10.0.0.5:3000/app');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('carries the requested URL for rewritten resolutions', async () => {
    invoke.mockResolvedValue({
      url: 'http://127.0.0.1:52345/app',
      rewritten: true,
      requestedUrl: 'http://daemon.localhost:3000/app',
      tunneled: true,
    });

    const resolved = await resolveBrowserLinkForOpen('http://daemon.localhost:3000/app');

    expect(resolved).toEqual({
      url: 'http://127.0.0.1:52345/app',
      requestedUrl: 'http://daemon.localhost:3000/app',
    });
  });

  it('omits the requested URL for non-rewritten resolutions', async () => {
    invoke.mockResolvedValue({ url: 'https://example.com/', rewritten: false });

    const resolved = await resolveBrowserLinkForOpen('https://example.com/');

    expect(resolved).toEqual({ url: 'https://example.com/' });
  });

  it('toasts the resolver error and still returns the rewritten URL', async () => {
    invoke.mockResolvedValue({
      url: 'http://10.0.0.5:3000/',
      rewritten: true,
      error: 'not reachable from this machine',
    });

    const resolved = await resolveBrowserLinkForOpen('http://localhost:3000/');

    expect(resolved.url).toBe('http://10.0.0.5:3000/');
    expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String), {
      description: 'not reachable from this machine',
    });
  });

  it('toasts the ambiguity warning for bare-loopback rewrites', async () => {
    invoke.mockResolvedValue({
      url: 'http://10.0.0.5:5173/',
      rewritten: true,
      warning: 'the URL used a bare loopback host',
    });

    const resolved = await resolveBrowserLinkForOpen('http://localhost:5173/');

    expect(resolved.url).toBe('http://10.0.0.5:5173/');
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.any(String), {
      description: 'the URL used a bare loopback host',
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('passes the URL through silently when the invoke fails', async () => {
    invoke.mockRejectedValue(new Error('no handler'));

    const resolved = await resolveBrowserLinkForOpen('http://localhost:3000/');

    expect(resolved).toEqual({ url: 'http://localhost:3000/' });
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});

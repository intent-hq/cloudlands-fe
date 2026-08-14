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

    const url = await resolveBrowserLinkForOpen('http://localhost:3000/app');

    expect(invoke).toHaveBeenCalledWith('browser:resolve-url', {
      url: 'http://localhost:3000/app',
    });
    expect(url).toBe('http://10.0.0.5:3000/app');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it('toasts the resolver error and still returns the rewritten URL', async () => {
    invoke.mockResolvedValue({
      url: 'http://10.0.0.5:3000/',
      rewritten: true,
      error: 'not reachable from this machine',
    });

    const url = await resolveBrowserLinkForOpen('http://localhost:3000/');

    expect(url).toBe('http://10.0.0.5:3000/');
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

    const url = await resolveBrowserLinkForOpen('http://localhost:5173/');

    expect(url).toBe('http://10.0.0.5:5173/');
    expect(mocks.toastWarning).toHaveBeenCalledWith('the URL used a bare loopback host');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('passes the URL through silently when the invoke fails', async () => {
    invoke.mockRejectedValue(new Error('no handler'));

    const url = await resolveBrowserLinkForOpen('http://localhost:3000/');

    expect(url).toBe('http://localhost:3000/');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });
});

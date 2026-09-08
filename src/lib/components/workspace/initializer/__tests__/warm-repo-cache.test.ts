/**
 * Unit tests for the opportunistic repo-cache warmer (repo.warmCache).
 *
 * FAKE transport only: the request function is injected, so no call reaches a
 * real daemon. Asserts the exact JSON-RPC method + params fired for GitHub
 * selections, per-instance dedup, non-GitHub no-ops, and that all failures
 * (busy, -32601 method-not-found) are swallowed silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRepoCacheWarmer } from '../warm-repo-cache';

const GH_URL = 'https://github.com/intent-hq/monorepo';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createRepoCacheWarmer', () => {
  it('fires repo.warmCache with the githubUrl for a GitHub selection', () => {
    const request = vi.fn().mockResolvedValue({ started: true });
    const warmer = createRepoCacheWarmer(request);

    warmer.warm({ repoType: 'github', githubUrl: GH_URL });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('repo.warmCache', { githubUrl: GH_URL });
  });

  it('dedupes repeat warms for the same githubUrl within one instance', () => {
    const request = vi.fn().mockResolvedValue({ started: true });
    const warmer = createRepoCacheWarmer(request);

    warmer.warm({ repoType: 'github', githubUrl: GH_URL });
    warmer.warm({ repoType: 'github', githubUrl: GH_URL });
    warmer.warm({ repoType: 'github', githubUrl: GH_URL });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fires again for a different githubUrl', () => {
    const request = vi.fn().mockResolvedValue({ started: true });
    const warmer = createRepoCacheWarmer(request);
    const other = 'https://github.com/intent-hq/intentd';

    warmer.warm({ repoType: 'github', githubUrl: GH_URL });
    warmer.warm({ repoType: 'github', githubUrl: other });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, 'repo.warmCache', { githubUrl: other });
  });

  it('a fresh warmer instance re-fires for a previously warmed githubUrl', () => {
    const request = vi.fn().mockResolvedValue({ started: true });
    createRepoCacheWarmer(request).warm({ repoType: 'github', githubUrl: GH_URL });
    createRepoCacheWarmer(request).warm({ repoType: 'github', githubUrl: GH_URL });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never fires for local or remote selections, or without a githubUrl', () => {
    const request = vi.fn().mockResolvedValue({ started: true });
    const warmer = createRepoCacheWarmer(request);

    warmer.warm({ repoType: 'local', githubUrl: '' });
    warmer.warm({ repoType: 'local', githubUrl: GH_URL });
    warmer.warm({ repoType: 'remote', githubUrl: GH_URL });
    warmer.warm({ repoType: 'github', githubUrl: '' });

    expect(request).not.toHaveBeenCalled();
  });

  it('swallows rejections silently (busy / -32601 / offline) without console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Method not found'), { code: -32601 }))
      .mockRejectedValueOnce(
        Object.assign(new Error('warm already in flight'), {
          data: { code: 'warm-in-flight' },
        }),
      );
    const warmer = createRepoCacheWarmer(request);

    expect(() => {
      warmer.warm({ repoType: 'github', githubUrl: GH_URL });
      warmer.warm({ repoType: 'github', githubUrl: 'https://github.com/intent-hq/ios' });
    }).not.toThrow();
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('a failed warm still counts for dedup (no retry storm)', async () => {
    const request = vi.fn().mockRejectedValue(new Error('daemon offline'));
    const warmer = createRepoCacheWarmer(request);

    warmer.warm({ repoType: 'github', githubUrl: GH_URL });
    await flush();
    warmer.warm({ repoType: 'github', githubUrl: GH_URL });

    expect(request).toHaveBeenCalledTimes(1);
  });
});

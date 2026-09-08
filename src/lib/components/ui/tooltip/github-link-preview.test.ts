import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubIssueDetails, GitHubPullRequestDetails } from '$lib/client';

vi.mock('$lib/client', () => ({
  appClient: { integrations: {} },
}));

import {
  GITHUB_LINK_PREVIEW_TTL_MS,
  clearGitHubLinkPreviewCache,
  createPreviewRequest,
  loadGitHubLinkPreview,
  type GitHubLinkPreviewClient,
} from './github-link-preview';

const PR_URL = 'https://github.com/octo/intent/pull/42';
const ISSUE_URL = 'https://github.com/octo/intent/issues/17';

const PR: GitHubPullRequestDetails = {
  owner: 'octo',
  repo: 'intent',
  number: 42,
  title: 'Add dark mode toggle',
  state: 'open',
  author: 'octocat',
  createdAt: '2026-01-02T09:00:00Z',
  updatedAt: '2026-01-02T14:00:00Z',
  url: PR_URL,
  headRef: 'feat/dark-mode',
  baseRef: 'main',
};

const ISSUE: GitHubIssueDetails = {
  owner: 'octo',
  repo: 'intent',
  number: 17,
  title: 'Theme flashes on first paint',
  state: 'closed',
  author: 'hubot',
  createdAt: '2026-01-01T08:00:00Z',
  updatedAt: '2026-01-02T10:00:00Z',
  url: ISSUE_URL,
};

function makeClient(): GitHubLinkPreviewClient & {
  githubPullRequest: ReturnType<typeof vi.fn>;
  githubIssue: ReturnType<typeof vi.fn>;
} {
  return {
    githubPullRequest: vi.fn(async () => PR),
    githubIssue: vi.fn(async () => ISSUE),
  };
}

describe('loadGitHubLinkPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearGitHubLinkPreviewCache();
  });
  afterEach(() => vi.useRealTimers());

  it('resolves null for non-GitHub URLs without touching the client', async () => {
    const client = makeClient();
    await expect(loadGitHubLinkPreview('https://example.com/x', { client })).resolves.toBeNull();
    await expect(
      loadGitHubLinkPreview('https://github.com/octo/intent/commit/abc', { client }),
    ).resolves.toBeNull();
    expect(client.githubPullRequest).not.toHaveBeenCalled();
    expect(client.githubIssue).not.toHaveBeenCalled();
  });

  it('routes a PR URL to githubPullRequest and tags the result kind: pr', async () => {
    const client = makeClient();
    const preview = await loadGitHubLinkPreview(PR_URL, { client });
    expect(client.githubPullRequest).toHaveBeenCalledWith('octo', 'intent', 42);
    expect(preview).toEqual({ kind: 'pr', ...PR });
  });

  it('routes an issue URL to githubIssue and tags the result kind: issue', async () => {
    const client = makeClient();
    const preview = await loadGitHubLinkPreview(ISSUE_URL, { client });
    expect(client.githubIssue).toHaveBeenCalledWith('octo', 'intent', 17);
    expect(preview).toEqual({ kind: 'issue', ...ISSUE });
  });

  it('serves a second hover from cache within the TTL, then re-fetches after it', async () => {
    const client = makeClient();
    await loadGitHubLinkPreview(PR_URL, { client });
    vi.advanceTimersByTime(GITHUB_LINK_PREVIEW_TTL_MS - 1);
    await loadGitHubLinkPreview(PR_URL, { client });
    expect(client.githubPullRequest).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await loadGitHubLinkPreview(PR_URL, { client });
    expect(client.githubPullRequest).toHaveBeenCalledTimes(2);
  });

  it('keys the cache per item so distinct links do not collide', async () => {
    const client = makeClient();
    await loadGitHubLinkPreview(PR_URL, { client });
    await loadGitHubLinkPreview('https://github.com/octo/intent/pull/43', { client });
    await loadGitHubLinkPreview('https://github.com/octo/intent/issues/42', { client });
    expect(client.githubPullRequest).toHaveBeenCalledTimes(2);
    expect(client.githubIssue).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent hovers for the same item into one request', async () => {
    const client = makeClient();
    const [a, b, c] = await Promise.all([
      loadGitHubLinkPreview(PR_URL, { client }),
      loadGitHubLinkPreview(PR_URL, { client }),
      loadGitHubLinkPreview(PR_URL, { client }),
    ]);
    expect(client.githubPullRequest).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('propagates a failure, does not cache it, and retries on the next hover', async () => {
    const client = makeClient();
    client.githubPullRequest
      .mockRejectedValueOnce(new Error('GitHub is not configured.'))
      .mockResolvedValueOnce(PR);

    await expect(loadGitHubLinkPreview(PR_URL, { client })).rejects.toThrow(
      'GitHub is not configured.',
    );
    await expect(loadGitHubLinkPreview(PR_URL, { client })).resolves.toEqual({
      kind: 'pr',
      ...PR,
    });
    expect(client.githubPullRequest).toHaveBeenCalledTimes(2);
  });

  it('aborting rejects the caller but the shared request still fills the cache', async () => {
    const client = makeClient();
    let release!: (value: GitHubPullRequestDetails) => void;
    client.githubPullRequest.mockImplementationOnce(
      () => new Promise<GitHubPullRequestDetails>((resolve) => (release = resolve)),
    );
    const controller = new AbortController();

    const aborted = loadGitHubLinkPreview(PR_URL, { client, signal: controller.signal });
    const other = loadGitHubLinkPreview(PR_URL, { client });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    release(PR);
    await expect(other).resolves.toEqual({ kind: 'pr', ...PR });
    await loadGitHubLinkPreview(PR_URL, { client });
    expect(client.githubPullRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const client = makeClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadGitHubLinkPreview(PR_URL, { client, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a pre-aborted hover still observes the shared request, so its failure is not an unhandled rejection', async () => {
    vi.useRealTimers();
    const client = makeClient();
    let fail!: (reason: Error) => void;
    client.githubPullRequest.mockImplementationOnce(
      () => new Promise<GitHubPullRequestDetails>((_, reject) => (fail = reject)),
    );
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(
        loadGitHubLinkPreview(PR_URL, { client, signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      fail(new Error('GitHub is not configured.'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(client.githubPullRequest).toHaveBeenCalledTimes(1);
  });
});

describe('createPreviewRequest (stale-response guard)', () => {
  it('only the most recent ticket is current', () => {
    const guard = createPreviewRequest();
    const first = guard.next();
    expect(first.isCurrent).toBe(true);

    const second = guard.next();
    expect(first.isCurrent).toBe(false);
    expect(second.isCurrent).toBe(true);
  });

  it('lets the UI drop an out-of-order resolution from an earlier hover', async () => {
    const guard = createPreviewRequest();
    let shown: string | null = null;
    const hover = (url: string, delayMs: number) => {
      const ticket = guard.next();
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          if (ticket.isCurrent) shown = url;
          resolve();
        }, delayMs),
      );
    };

    vi.useFakeTimers();
    try {
      const slowFirst = hover(PR_URL, 50);
      const fastSecond = hover(ISSUE_URL, 10);
      await vi.advanceTimersByTimeAsync(60);
      await Promise.all([slowFirst, fastSecond]);
    } finally {
      vi.useRealTimers();
    }
    expect(shown).toBe(ISSUE_URL);
  });

  it('invalidate() retires the current ticket without issuing a new one', () => {
    const guard = createPreviewRequest();
    const ticket = guard.next();
    guard.invalidate();
    expect(ticket.isCurrent).toBe(false);
    expect(guard.next().isCurrent).toBe(true);
  });
});

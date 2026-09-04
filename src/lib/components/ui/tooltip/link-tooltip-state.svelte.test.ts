/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitHubIssueDetails, GitHubPullRequestDetails } from '$lib/client';

const integrations = vi.hoisted(() => ({
  githubPullRequest: vi.fn(),
  githubIssue: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { integrations },
}));

import { clearGitHubLinkPreviewCache } from './github-link-preview';
import { hideLinkTooltip, showLinkTooltip, state } from './link-tooltip-state.svelte';

const SHOW_DELAY_MS = 300;

function pr(number: number): GitHubPullRequestDetails {
  return {
    owner: 'octo',
    repo: 'intent',
    number,
    title: `PR ${number}`,
    state: 'open',
    author: 'octocat',
    createdAt: '2026-01-02T09:00:00Z',
    updatedAt: '2026-01-02T14:00:00Z',
    url: `https://github.com/octo/intent/pull/${number}`,
    headRef: 'feat/x',
    baseRef: 'main',
  };
}

const ISSUE: GitHubIssueDetails = {
  owner: 'octo',
  repo: 'intent',
  number: 17,
  title: 'Theme flashes on first paint',
  state: 'closed',
  author: 'hubot',
  createdAt: '2026-01-01T08:00:00Z',
  updatedAt: '2026-01-02T10:00:00Z',
  url: 'https://github.com/octo/intent/issues/17',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function anchorFor(url: string, rect: Partial<DOMRect> = {}): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.getBoundingClientRect = () =>
    ({ left: 100, top: 200, width: 40, height: 16, bottom: 216, right: 140, ...rect }) as DOMRect;
  return anchor;
}

function hover(url: string): void {
  showLinkTooltip(anchorFor(url), url);
  vi.advanceTimersByTime(SHOW_DELAY_MS);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('link tooltip GitHub preview state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearGitHubLinkPreviewCache();
    integrations.githubPullRequest.mockReset();
    integrations.githubIssue.mockReset();
    hideLinkTooltip();
  });

  afterEach(() => {
    hideLinkTooltip();
    vi.useRealTimers();
  });

  it('shows the loading card within the hover delay, then the details', async () => {
    const request = deferred<GitHubPullRequestDetails>();
    integrations.githubPullRequest.mockReturnValue(request.promise);

    showLinkTooltip(anchorFor(pr(42).url), pr(42).url);
    expect(state.visible).toBe(false);
    expect(state.preview.status).toBe('idle');

    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(state.visible).toBe(true);
    expect(state.url).toBe(pr(42).url);
    expect(state.anchorBottom).toBe(216);
    expect(state.preview.status).toBe('loading');
    expect(integrations.githubPullRequest).toHaveBeenCalledWith('octo', 'intent', 42);

    request.resolve(pr(42));
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(42) } });
  });

  it('loads issue details through the issue endpoint', async () => {
    integrations.githubIssue.mockResolvedValue(ISSUE);
    hover(ISSUE.url);
    await flush();
    expect(integrations.githubIssue).toHaveBeenCalledWith('octo', 'intent', 17);
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'issue', ...ISSUE } });
  });

  it('falls back to the URL-only tooltip when the daemon call fails', async () => {
    integrations.githubPullRequest.mockRejectedValue(new Error('GitHub is not configured.'));
    hover(pr(42).url);
    expect(state.preview.status).toBe('loading');
    await flush();
    expect(state.visible).toBe(true);
    expect(state.preview).toEqual({ status: 'error' });
  });

  it('leaves non-GitHub links on the plain tooltip without calling the daemon', async () => {
    hover('https://example.com/docs');
    await flush();
    expect(state.visible).toBe(true);
    expect(state.preview).toEqual({ status: 'idle' });
    expect(integrations.githubPullRequest).not.toHaveBeenCalled();
    expect(integrations.githubIssue).not.toHaveBeenCalled();
  });

  it('resets the preview when the tooltip hides', async () => {
    integrations.githubPullRequest.mockResolvedValue(pr(42));
    hover(pr(42).url);
    await flush();
    expect(state.preview.status).toBe('ready');

    hideLinkTooltip();
    expect(state.visible).toBe(false);
    expect(state.preview).toEqual({ status: 'idle' });
  });

  it('ignores a late response for a previous hover (stale guard)', async () => {
    const slow = deferred<GitHubPullRequestDetails>();
    const fast = deferred<GitHubPullRequestDetails>();
    integrations.githubPullRequest.mockImplementation((_o: string, _r: string, n: number) =>
      n === 1 ? slow.promise : fast.promise,
    );

    hover(pr(1).url);
    hideLinkTooltip();
    hover(pr(2).url);
    expect(state.url).toBe(pr(2).url);
    expect(state.preview.status).toBe('loading');

    fast.resolve(pr(2));
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(2) } });

    slow.resolve(pr(1));
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(2) } });
  });

  it('does not resurrect a preview whose hover ended before the response', async () => {
    const request = deferred<GitHubPullRequestDetails>();
    integrations.githubPullRequest.mockReturnValue(request.promise);

    hover(pr(42).url);
    hideLinkTooltip();
    request.resolve(pr(42));
    await flush();
    expect(state.visible).toBe(false);
    expect(state.preview).toEqual({ status: 'idle' });
  });

  it('a late failure never clobbers the current hover', async () => {
    const failing = deferred<GitHubPullRequestDetails>();
    integrations.githubPullRequest.mockImplementation((_o: string, _r: string, n: number) =>
      n === 1 ? failing.promise : Promise.resolve(pr(2)),
    );

    hover(pr(1).url);
    hideLinkTooltip();
    hover(pr(2).url);
    await flush();
    expect(state.preview.status).toBe('ready');

    failing.reject(new Error('not found'));
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(2) } });
  });
});

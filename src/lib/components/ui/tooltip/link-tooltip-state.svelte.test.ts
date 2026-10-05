/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
import {
  RepositoryResourceCaptureSchema,
  RepositoryResourceResultSchema,
  type RepositoryResourceSession,
} from '$shared/types/repository-resource-read';
import type { GitHubIssueDetails, GitHubPullRequestDetails } from '$lib/client';

const integrations = vi.hoisted(() => ({
  githubPullRequest: vi.fn(),
  githubIssue: vi.fn(),
  captureRepositoryResource: vi.fn(),
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
  anchor.dataset.testHoverAnchor = '';
  document.body.append(anchor);
  anchor.getBoundingClientRect = () =>
    ({ left: 100, top: 200, width: 40, height: 16, bottom: 216, right: 140, ...rect }) as DOMRect;
  return anchor;
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Hover past the show delay and let the loader reach the client (it imports it lazily). */
async function hover(url: string): Promise<void> {
  showLinkTooltip(anchorFor(url), url);
  vi.advanceTimersByTime(SHOW_DELAY_MS);
  await flush();
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
    document.querySelectorAll('[data-test-hover-anchor]').forEach((anchor) => anchor.remove());
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
    await flush();
    expect(integrations.githubPullRequest).toHaveBeenCalledWith('octo', 'intent', 42);

    request.resolve(pr(42));
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(42) } });
  });

  it('loads issue details through the issue endpoint', async () => {
    integrations.githubIssue.mockResolvedValue(ISSUE);
    await hover(ISSUE.url);
    await flush();
    expect(integrations.githubIssue).toHaveBeenCalledWith('octo', 'intent', 17);
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'issue', ...ISSUE } });
  });

  it('retains a classified rate-limit failure after the loading preview', async () => {
    const request = deferred<GitHubPullRequestDetails>();
    integrations.githubPullRequest.mockReturnValue(request.promise);

    await hover(pr(42).url);
    expect(state.preview.status).toBe('loading');
    request.reject(
      Object.assign(new Error('source control rate limited'), {
        rpcCode: -32603,
        data: { code: 'rate-limited' },
      }),
    );
    await flush();

    expect(state.visible).toBe(true);
    expect(state.url).toBe(pr(42).url);
    expect(state.preview).toEqual({ status: 'error', reason: 'rate-limited' });
  });

  it('keeps an unavailable preview when the daemon call fails', async () => {
    integrations.githubPullRequest.mockRejectedValue(new Error('GitHub is not configured.'));
    showLinkTooltip(anchorFor(pr(42).url), pr(42).url);
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(state.preview.status).toBe('loading');
    await flush();
    expect(state.visible).toBe(true);
    expect(state.preview).toEqual({ status: 'error', reason: 'unavailable' });
  });

  it('retries a failed hover and displays fresh details', async () => {
    integrations.githubPullRequest.mockRejectedValueOnce({ data: { code: 'rate-limited' } });
    await hover(pr(42).url);
    expect(state.preview.status).toBe('error');
    hideLinkTooltip();

    const updated = { ...pr(42), title: 'Fresh details', state: 'merged' as const };
    integrations.githubPullRequest.mockResolvedValueOnce(updated);
    await hover(pr(42).url);
    expect(integrations.githubPullRequest).toHaveBeenCalledTimes(2);
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...updated } });
  });

  it('keeps the issue reference when its details are rate limited', async () => {
    integrations.githubIssue.mockRejectedValue({ data: { code: 'rate-limited' } });
    await hover(ISSUE.url);
    expect(state.visible).toBe(true);
    expect(state.url).toBe(ISSUE.url);
    expect(state.preview).toEqual({ status: 'error', reason: 'rate-limited' });
  });

  it('leaves non-GitHub links on the plain tooltip without calling the daemon', async () => {
    await hover('https://example.com/docs');
    await flush();
    expect(state.visible).toBe(true);
    expect(state.preview).toEqual({ status: 'idle' });
    expect(integrations.githubPullRequest).not.toHaveBeenCalled();
    expect(integrations.githubIssue).not.toHaveBeenCalled();
  });

  it('resets the preview when the tooltip hides', async () => {
    integrations.githubPullRequest.mockResolvedValue(pr(42));
    await hover(pr(42).url);
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

    await hover(pr(1).url);
    hideLinkTooltip();
    await hover(pr(2).url);
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

    await hover(pr(42).url);
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

    await hover(pr(1).url);
    hideLinkTooltip();
    await hover(pr(2).url);
    await flush();
    expect(state.preview.status).toBe('ready');

    failing.reject({ data: { code: 'rate-limited' } });
    await flush();
    expect(state.preview).toEqual({ status: 'ready', data: { kind: 'pr', ...pr(2) } });
  });
});

describe('original GitLab hover lifetime', () => {
  function session(result = RepositoryResourceResultSchema.parse(fixture.mergeRequest)) {
    let retire: (() => void) | undefined;
    const source: RepositoryResourceSession = {
      capture: RepositoryResourceCaptureSchema.parse(fixture.capture),
      onRetired: (listener) => {
        retire = listener;
        return () => {
          retire = undefined;
        };
      },
      detail: vi.fn().mockResolvedValue(result),
      release: vi.fn().mockResolvedValue(undefined),
    };
    return { source, retire: () => retire?.() };
  }
  const mrUrl = fixture.mergeRequest.outcome.snapshot.details.url;
  const issueUrl = fixture.issue.outcome.issue.url;
  async function mountHover(url = mrUrl) {
    const surface = document.createElement('div');
    surface.dataset.workspaceSurface = 'workspace-A';
    document.body.append(surface);
    const anchor = anchorFor(url);
    surface.append(anchor);
    showLinkTooltip(anchor, url);
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    return { surface, anchor };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    hideLinkTooltip();
  });
  afterEach(() => {
    hideLinkTooltip();
    document
      .querySelectorAll('[data-test-hover-anchor], [data-workspace-surface]')
      .forEach((node) => node.remove());
    vi.useRealTimers();
  });

  it('uses the exact workspace and configured full instance while keeping the original URL', async () => {
    const h = session();
    integrations.captureRepositoryResource.mockResolvedValue(h.source);
    const original = mrUrl + '/diffs?view=parallel#note_42';
    await mountHover(original);
    expect(integrations.captureRepositoryResource).toHaveBeenCalledWith('workspace-A');
    expect(h.source.detail).toHaveBeenCalledWith(fixture.mergeRequest.target);
    expect(state.url).toBe(original);
    expect(state.preview).toMatchObject({
      status: 'ready',
      data: { provider: 'gitlab', kind: 'pr', resource: fixture.mergeRequest.target },
    });
    expect(integrations.githubPullRequest).not.toHaveBeenCalled();
    expect(integrations.githubIssue).not.toHaveBeenCalled();
    hideLinkTooltip();
    hideLinkTooltip();
    expect(h.source.release).toHaveBeenCalledTimes(1);
  });
  it.each(['success', 'error'])(
    'discards an older MR %s after hovering issue with the same IID',
    async (outcome) => {
      const first = session();
      const second = session(RepositoryResourceResultSchema.parse(fixture.issue));
      const slow = deferred<ReturnType<typeof RepositoryResourceResultSchema.parse>>();
      vi.mocked(first.source.detail).mockReturnValue(slow.promise);
      integrations.captureRepositoryResource
        .mockResolvedValueOnce(first.source)
        .mockResolvedValueOnce(second.source);
      await mountHover();
      expect(state.preview.status).toBe('loading');
      await mountHover(issueUrl);
      expect(first.source.release).toHaveBeenCalledTimes(1);
      expect(state.preview).toMatchObject({
        status: 'ready',
        data: { kind: 'issue', resource: fixture.issue.target },
      });
      if (outcome === 'success')
        slow.resolve(RepositoryResourceResultSchema.parse(fixture.mergeRequest));
      else slow.reject(new Error('private obsolete error'));
      await flush();
      expect(state.preview).toMatchObject({ status: 'ready', data: { kind: 'issue' } });
    },
  );
  it.each(['unmount', 'workspace', 'href', 'retirement'])(
    'removes settled private content after %s',
    async (reason) => {
      const h = session();
      integrations.captureRepositoryResource.mockResolvedValue(h.source);
      const { surface, anchor } = await mountHover();
      expect(state.preview.status).toBe('ready');
      if (reason === 'unmount') anchor.remove();
      else if (reason === 'workspace') surface.dataset.workspaceSurface = 'workspace-B';
      else if (reason === 'href') anchor.href = issueUrl;
      else {
        h.retire();
        h.retire();
      }
      await flush();
      expect(state.preview).toEqual({ status: 'idle' });
      expect(h.source.release).toHaveBeenCalledTimes(1);
    },
  );
  it('releases a capture that arrives after unmount without making a detail request', async () => {
    const h = session();
    const pending = deferred<RepositoryResourceSession>();
    integrations.captureRepositoryResource.mockReturnValue(pending.promise);
    const { anchor } = await mountHover();
    anchor.remove();
    await flush();
    pending.resolve(h.source);
    await flush();
    expect(h.source.detail).not.toHaveBeenCalled();
    expect(h.source.release).toHaveBeenCalledTimes(1);
    expect(state.preview.status).toBe('idle');
  });
  it('does not capture without workspace context or for a work-item alias', async () => {
    await hover(mrUrl);
    await mountHover(mrUrl.replace('merge_requests', 'work_items'));
    expect(integrations.captureRepositoryResource).not.toHaveBeenCalled();
  });
  it('releases an unconfigured host without a credential or detail request', async () => {
    const h = session();
    integrations.captureRepositoryResource.mockResolvedValue(h.source);
    await mountHover(mrUrl.replace('gitlab.example.test', 'foreign.test'));
    expect(h.source.detail).not.toHaveBeenCalled();
    expect(h.source.release).toHaveBeenCalledTimes(1);
    expect(state.preview.status).toBe('idle');
  });
  it.each([
    'authentication',
    'project-denied',
    'resource-denied',
    'optional-restricted',
    'optional-unavailable',
    'rate-limited',
    'transient',
    'unavailable',
    'unknown',
  ] as const)('keeps the sanitized %s distinction', async (code) => {
    const h = session(
      RepositoryResourceResultSchema.parse({
        ...fixture.mergeRequest,
        outcome: { kind: 'failure', code, status: null },
      }),
    );
    integrations.captureRepositoryResource.mockResolvedValue(h.source);
    await mountHover();
    expect(state.preview).toMatchObject({
      status: 'error',
      reason: code,
      resource: fixture.mergeRequest.target,
    });
  });
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import { BackendError } from '$lib/client/live/backend-transport-types';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/client', async () => {
  const { LiveIntegrationsClient } = await import('$lib/client/live/live-integrations-client');
  return { appClient: { integrations: new LiveIntegrationsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import LinkTooltip from './LinkTooltip.svelte';
import { clearGitHubLinkPreviewCache } from './github-link-preview';
import { hideLinkTooltip, showLinkTooltip } from './link-tooltip-state.svelte';

const request = vi.mocked(backendRequest);
const PR_URL = 'https://github.com/octo/intent/pull/42';

/** PROTOCOL §5.27 GithubPullRequest response. */
const PULL = {
  number: 42,
  title: 'Fresh pull request details',
  state: 'open',
  htmlUrl: PR_URL,
  createdAt: '2026-01-02T09:00:00Z',
  updatedAt: '2026-01-02T14:00:00Z',
  user: { login: 'octocat', avatarUrl: '', htmlUrl: 'https://github.com/octocat' },
  headRef: 'feat/hover',
  baseRef: 'main',
  headSha: 'abc',
  baseSha: 'def',
  merged: false,
  draft: false,
  labels: [],
  comments: 0,
  reviewComments: 0,
  commits: 1,
  additions: 10,
  deletions: 2,
  changedFiles: 1,
};

async function hover(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  showLinkTooltip(anchor, url);
  await vi.advanceTimersByTimeAsync(300);
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
  flushSync();
}

describe('LinkTooltip with the live integrations seam', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    request.mockReset();
    clearGitHubLinkPreviewCache();
    hideLinkTooltip();
  });

  afterEach(() => {
    hideLinkTooltip();
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['queued', 'merged'] as const)(
    'keeps the card on a rate limit, then renders fresh %s details on the next hover',
    async (nextState) => {
      let reject!: (error: unknown) => void;
      request.mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));
      render(LinkTooltip);

      await hover(PR_URL);
      const tooltip = screen.getByRole('tooltip');
      expect(within(tooltip).getByRole('status').getAttribute('aria-busy')).toBe('true');
      expect(request).toHaveBeenCalledWith('github.pulls.get', {
        owner: 'octo',
        repo: 'intent',
        number: 42,
      });

      reject(
        new BackendError({
          code: 'rate-limited',
          rpcCode: -32603,
          message: 'source control rate limited: private server detail',
          data: { code: 'rate-limited' },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      flushSync();

      expect(screen.getByRole('tooltip')).toBe(tooltip);
      expect(within(tooltip).getByText('octo/intent #42')).toBeTruthy();
      expect(within(tooltip).getByRole('status').textContent?.trim()).toBe(
        m.ui_linkTooltip_gitHubRateLimited_description(),
      );
      expect(within(tooltip).getByRole('status').hasAttribute('aria-busy')).toBe(false);
      expect(tooltip.textContent).not.toContain('private server detail');

      hideLinkTooltip();
      flushSync();
      request.mockResolvedValueOnce({
        pull: {
          ...PULL,
          merged: nextState === 'merged',
          state: nextState === 'merged' ? 'closed' : 'open',
          isInMergeQueue: nextState === 'queued',
        },
      });
      await hover(PR_URL);

      const recovered = screen.getByRole('tooltip');
      expect(within(recovered).queryByRole('status')).toBeNull();
      expect(within(recovered).getByText(PULL.title)).toBeTruthy();
      expect(
        within(recovered).getByText(
          nextState === 'merged'
            ? m.ui_linkTooltip_gitHubStateMerged_label()
            : m.ui_linkTooltip_gitHubStateQueued_label(),
        ),
      ).toBeTruthy();
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['pull', 'github.pulls.get'],
    ['issues', 'github.issues.get'],
  ])('retains an unavailable %s card for an unclassified failure', async (path, method) => {
    request.mockRejectedValueOnce(new Error('raw connection failure'));
    render(LinkTooltip);
    await hover(`https://github.com/octo/intent/${path}/42`);

    const tooltip = screen.getByRole('tooltip');
    expect(request).toHaveBeenCalledWith(method, { owner: 'octo', repo: 'intent', number: 42 });
    expect(within(tooltip).getByText('octo/intent #42')).toBeTruthy();
    expect(within(tooltip).getByRole('status').textContent?.trim()).toBe(
      m.ui_linkTooltip_gitHubUnavailable_description(),
    );
  });
});

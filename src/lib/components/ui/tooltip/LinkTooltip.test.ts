/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
import {
  RepositoryResourceCaptureSchema,
  RepositoryResourceResultSchema,
} from '$shared/types/repository-resource-read';
import { BackendError } from '$lib/client/live/backend-transport-types';

const reconnect = vi.hoisted(() => new Set<() => void>());
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  captureBackendRepositoryResource: vi.fn(),
  onBackendReconnected: (handler: () => void) => {
    reconnect.add(handler);
    return () => reconnect.delete(handler);
  },
}));
vi.mock('$lib/client', async () => {
  const { LiveIntegrationsClient } = await import('$lib/client/live/live-integrations-client');
  return { appClient: { integrations: new LiveIntegrationsClient() } };
});

import {
  backendRequest,
  captureBackendRepositoryResource,
} from '$lib/client/live/backend-transport';
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

async function hover(url: string, workspaceId?: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.dataset.testHoverAnchor = '';
  document.body.append(anchor);
  showLinkTooltip(anchor, url, workspaceId);
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
    vi.mocked(captureBackendRepositoryResource).mockReset();
    clearGitHubLinkPreviewCache();
    hideLinkTooltip();
  });

  afterEach(() => {
    hideLinkTooltip();
    cleanup();
    document.querySelectorAll('[data-test-hover-anchor]').forEach((anchor) => anchor.remove());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps reused preview IDs separate across workspaces and reconnects', async () => {
    let resolveOld!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)));
    render(LinkTooltip);
    await hover(PR_URL, 'a');
    expect(request).toHaveBeenLastCalledWith('github.pulls.get', {
      owner: 'octo',
      repo: 'intent',
      number: 42,
      workspaceId: 'a',
    });
    for (const handler of reconnect) handler();
    request.mockResolvedValueOnce({ pull: { ...PULL, title: 'Workspace B' } });
    await hover(PR_URL, 'b');
    expect(request).toHaveBeenLastCalledWith('github.pulls.get', {
      owner: 'octo',
      repo: 'intent',
      number: 42,
      workspaceId: 'b',
    });
    resolveOld({ pull: { ...PULL, title: 'Late workspace A' } });
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(screen.getByText('Workspace B')).toBeTruthy();
    expect(screen.queryByText('Late workspace A')).toBeNull();
  });

  it.each(['mergeRequest', 'issue'] as const)(
    'renders safe GitLab %s facts through the real client',
    async (key) => {
      const value = structuredClone(fixture[key]);
      const title = '<img src=x onerror=alert(1)> Private title';
      if ('snapshot' in value.outcome) value.outcome.snapshot.details.title = title;
      else value.outcome.issue.title = title;
      const result = RepositoryResourceResultSchema.parse(value);
      const release = vi.fn().mockResolvedValue(undefined);
      vi.mocked(captureBackendRepositoryResource).mockResolvedValue({
        capture: RepositoryResourceCaptureSchema.parse(fixture.capture),
        onRetired: () => () => {},
        detail: vi.fn().mockResolvedValue(result),
        release,
      });
      render(LinkTooltip);
      const url =
        key === 'issue'
          ? fixture.issue.outcome.issue.url
          : fixture.mergeRequest.outcome.snapshot.details.url;
      await hover(url, 'workspace-A');
      const card = screen.getByRole('tooltip');
      expect(within(card).getByText(title)).toBeTruthy();
      expect(card.querySelector('img')).toBeNull();
      expect(card.textContent).toContain(key === 'issue' ? '#42' : '!42');
      expect(within(card).getByTestId('resource-instance').textContent?.trim()).toBe(
        fixture.capture.instances[0].instanceBaseUrl,
      );
      expect(within(card).getByTestId('resource-project').textContent?.trim()).toBe(
        fixture.issue.target.repository.projectPath,
      );
      expect(captureBackendRepositoryResource).toHaveBeenCalledWith('workspace-A');
      expect(request).not.toHaveBeenCalled();
      hideLinkTooltip();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps unknown MR state neutral and omits absent author/date/branch facts', async () => {
    const value = structuredClone(fixture.mergeRequest);
    Object.assign(value.outcome.snapshot.details, {
      state: null,
      author: null,
      createdAt: null,
      updatedAt: null,
      sourceBranch: null,
      targetBranch: null,
    });
    vi.mocked(captureBackendRepositoryResource).mockResolvedValue({
      capture: RepositoryResourceCaptureSchema.parse(fixture.capture),
      onRetired: () => () => {},
      detail: async () => RepositoryResourceResultSchema.parse(value),
      release: async () => {},
    });
    render(LinkTooltip);
    await hover(value.outcome.snapshot.details.url, 'workspace-A');
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText(m.ui_linkTooltip_resourceUnknown_label())).toBeTruthy();
    expect(within(card).queryByText(m.ui_linkTooltip_gitHubStateOpen_label())).toBeNull();
    expect(card.textContent).not.toMatch(/undefined|NaN|null/);
    expect(card.querySelector('.github-link-card-branches')).toBeNull();
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

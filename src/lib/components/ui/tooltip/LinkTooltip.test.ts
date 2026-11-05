/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { clearGitHubLinkPreviewCache } from './github-link-preview';
import { hideLinkTooltip, showLinkTooltip, state } from './link-tooltip-state.svelte';

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
}

describe('repository previews with the live integrations seam', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    request.mockReset();
    vi.mocked(captureBackendRepositoryResource).mockReset();
    clearGitHubLinkPreviewCache();
    hideLinkTooltip();
  });

  afterEach(() => {
    hideLinkTooltip();
    document.querySelectorAll('[data-test-hover-anchor]').forEach((anchor) => anchor.remove());
    vi.useRealTimers();
  });

  it('keeps reused preview IDs separate across workspaces and reconnects', async () => {
    let resolveOld!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)));
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
    expect(state.preview).toMatchObject({ status: 'ready', data: { title: 'Workspace B' } });
  });

  it.each(['mergeRequest', 'issue'] as const)(
    'captures and releases GitLab %s requests through the real client',
    async (key) => {
      const result = RepositoryResourceResultSchema.parse(fixture[key]);
      const detail = vi.fn().mockResolvedValue(result);
      const release = vi.fn().mockResolvedValue(undefined);
      vi.mocked(captureBackendRepositoryResource).mockResolvedValue({
        capture: RepositoryResourceCaptureSchema.parse(fixture.capture),
        onRetired: () => () => {},
        detail,
        release,
      });
      const url =
        key === 'issue'
          ? fixture.issue.outcome.issue.url
          : fixture.mergeRequest.outcome.snapshot.details.url;
      await hover(url, 'workspace-A');
      expect(detail).toHaveBeenCalledWith(fixture[key].target);
      expect(captureBackendRepositoryResource).toHaveBeenCalledWith('workspace-A');
      expect(request).not.toHaveBeenCalled();
      hideLinkTooltip();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['queued', 'merged'] as const)(
    'retries a rate-limited request and receives fresh %s data',
    async (nextState) => {
      let reject!: (error: unknown) => void;
      request.mockReturnValueOnce(new Promise((_, fail) => (reject = fail)));

      await hover(PR_URL);
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

      expect(state.preview).toEqual({ status: 'error', reason: 'rate-limited' });

      hideLinkTooltip();
      request.mockResolvedValueOnce({
        pull: {
          ...PULL,
          merged: nextState === 'merged',
          state: nextState === 'merged' ? 'closed' : 'open',
          isInMergeQueue: nextState === 'queued',
        },
      });
      await hover(PR_URL);

      expect(state.preview).toMatchObject({ status: 'ready', data: { title: PULL.title } });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['pull', 'github.pulls.get'],
    ['issues', 'github.issues.get'],
  ])('classifies an unrecognized %s request failure as unavailable', async (path, method) => {
    request.mockRejectedValueOnce(new Error('raw connection failure'));
    await hover(`https://github.com/octo/intent/${path}/42`);

    expect(request).toHaveBeenCalledWith(method, { owner: 'octo', repo: 'intent', number: 42 });
    expect(state.preview).toEqual({ status: 'error', reason: 'unavailable' });
  });
});

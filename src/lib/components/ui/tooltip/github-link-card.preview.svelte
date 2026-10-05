<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { appClient, MockAppClient } from '$lib/client';
  import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
  import {
    RepositoryResourceCaptureSchema,
    RepositoryResourceResultSchema,
    type RepositoryResourceSession,
    type RepositoryResourceFailure,
  } from '$shared/types/repository-resource-read';
  import { observeGitLabLinkPreview } from './github-link-preview';
  import { mockGitHubPullRequestQueued } from '$lib/client/mock/fixtures';
  import { clearGitHubLinkPreviewCache, type GitHubLinkPreviewClient } from './github-link-preview';

  export interface GitHubLinkCardPreviewProps {
    label: string;
    expected: string;
    url: string;
    client: GitHubLinkPreviewClient;
    interactive?: boolean;
    resourceClient?: {
      captureRepositoryResource: (workspaceId: string) => Promise<RepositoryResourceSession>;
    };
  }

  const mock = new MockAppClient().integrations;
  const REPO_URL = 'https://github.com/acme/web-app';

  function prClient(
    overrides: Partial<Awaited<ReturnType<GitHubLinkPreviewClient['githubPullRequest']>>>,
  ): GitHubLinkPreviewClient {
    return {
      githubPullRequest: async (owner, repo, number) => ({
        ...(await mock.githubPullRequest(owner, repo, number)),
        ...overrides,
      }),
      githubIssue: mock.githubIssue,
    };
  }

  const scenario = (
    label: string,
    expected: string,
    url: string,
    client: GitHubLinkPreviewClient,
    interactive = false,
  ) => ({
    props: { label, expected, url, client, interactive },
    setup: clearGitHubLinkPreviewCache,
  });

  function setupHoverClient(client: GitHubLinkPreviewClient) {
    const originalPull = appClient.integrations.githubPullRequest;
    const originalIssue = appClient.integrations.githubIssue;
    // Simulate latency only for actual hovers; the inline fixture settles immediately.
    appClient.integrations.githubPullRequest = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return client.githubPullRequest(...args);
    };
    appClient.integrations.githubIssue = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return client.githubIssue(...args);
    };
    return () => {
      appClient.integrations.githubPullRequest = originalPull;
      appClient.integrations.githubIssue = originalIssue;
    };
  }

  function resourceScenario(
    label: string,
    key: 'mergeRequest' | 'issue',
    mode: 'ready' | 'loading' | 'unknown' | RepositoryResourceFailure = 'ready',
    publicInstance = false,
  ) {
    const raw = structuredClone(fixture[key]);
    const capture = RepositoryResourceCaptureSchema.parse(fixture.capture);
    if (publicInstance) {
      const repository = {
        provider: 'gitlab' as const,
        instanceBaseUrl: 'https://gitlab.com',
        projectPath: 'gitlab-org/gitlab',
      };
      raw.target.repository = repository;
      capture.instances[0].instanceBaseUrl = repository.instanceBaseUrl;
      if ('snapshot' in raw.outcome) {
        raw.outcome.snapshot.resource.repository = repository;
        raw.outcome.snapshot.details.resource.repository = repository;
        raw.outcome.snapshot.details.url =
          'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/42';
      }
    }
    const url =
      'snapshot' in raw.outcome ? raw.outcome.snapshot.details.url : raw.outcome.issue.url;
    if (mode === 'unknown' && 'snapshot' in raw.outcome)
      Object.assign(raw.outcome.snapshot.details, { state: null, author: null, updatedAt: null });
    const result = RepositoryResourceResultSchema.parse(
      mode === 'ready' || mode === 'loading' || mode === 'unknown'
        ? raw
        : { ...raw, outcome: { kind: 'failure', code: mode, status: null } },
    );
    return {
      props: {
        label,
        expected:
          'Controlled original-connection response; configured instance and full project stay visible.',
        url,
        client: mock,
        resourceClient: {
          captureRepositoryResource: async () => ({
            capture,
            onRetired: () => () => {},
            release: async () => {},
            detail: () =>
              mode === 'loading' ? new Promise<typeof result>(() => {}) : Promise.resolve(result),
          }),
        },
      },
    };
  }

  export const preview = definePreview<GitHubLinkCardPreviewProps>({
    id: 'github-link-card',
    title: 'GitHub link hover card',
    defaultState: 'pr-open',
    states: {
      'gitlab-com-mr': resourceScenario(
        'GitLab.com — merge request',
        'mergeRequest',
        'ready',
        true,
      ),
      'gitlab-self-managed-mr': resourceScenario(
        'Self-managed GitLab — merge request',
        'mergeRequest',
      ),
      'gitlab-issue': resourceScenario('Self-managed GitLab — issue', 'issue'),
      'gitlab-loading': resourceScenario('GitLab — loading', 'mergeRequest', 'loading'),
      'gitlab-restricted': resourceScenario('GitLab — restricted', 'issue', 'resource-denied'),
      'gitlab-unavailable': resourceScenario('GitLab — unavailable', 'issue', 'unavailable'),
      'gitlab-rate-limited': resourceScenario(
        'GitLab — rate limited',
        'mergeRequest',
        'rate-limited',
      ),
      'gitlab-unknown': resourceScenario('GitLab — unknown state', 'mergeRequest', 'unknown'),
      loading: scenario(
        'Loading',
        'Header from the URL, skeleton lines, URL still visible while details load.',
        `${REPO_URL}/pull/42`,
        {
          githubPullRequest: () => new Promise(() => {}),
          githubIssue: () => new Promise(() => {}),
        },
      ),
      'pr-open': scenario(
        'PR — open',
        'Green PR icon + Open badge, title, author, relative time, head → base.',
        `${REPO_URL}/pull/42`,
        mock,
      ),
      'pr-merged': scenario(
        'PR — merged',
        'Merge icon + Merged badge in the primary tone.',
        `${REPO_URL}/pull/43`,
        prClient({
          state: 'merged',
          headRef: 'fix/theme-flash',
          updatedAt: '2026-01-03T09:30:00.000Z',
        }),
      ),
      'pr-queued': scenario(
        'PR — queued',
        'Hourglass icon + Queued badge in the info tone for a PR in the merge queue.',
        `${REPO_URL}/pull/${mockGitHubPullRequestQueued.number}`,
        mock,
      ),
      'pr-draft': scenario(
        'PR — draft',
        'Muted icon + Draft badge; long title clamps to two lines.',
        `${REPO_URL}/pull/44`,
        prClient({
          state: 'draft',
          title:
            'Rework the settings navigation so that every section is reachable from the keyboard and screen readers announce the active pane',
          headRef: 'feat/settings-navigation-a11y-rework',
        }),
      ),
      'issue-closed': scenario(
        'Issue — closed',
        'Check icon + Closed badge for an issue; no branch line.',
        `${REPO_URL}/issues/17`,
        {
          githubPullRequest: mock.githubPullRequest,
          githubIssue: async (owner, repo, number) => ({
            ...(await mock.githubIssue(owner, repo, number)),
            state: 'closed',
          }),
        },
      ),
      error: scenario(
        'Error (not configured / not found)',
        'Keeps the PR reference, unavailable explanation, URL, and link actions.',
        `${REPO_URL}/pull/404`,
        {
          githubPullRequest: async () => {
            throw new Error('GitHub is not configured.');
          },
          githubIssue: async () => {
            throw new Error('GitHub is not configured.');
          },
        },
      ),
      'rate-limited': scenario(
        'GitHub rate limit',
        'Keeps the PR reference and explains the rate limit. Hover the link to exercise loading and failure; click for actions.',
        `${REPO_URL}/pull/42`,
        {
          githubPullRequest: async () => {
            throw Object.assign(new Error('source control rate limited'), {
              rpcCode: -32603,
              data: { code: 'rate-limited' },
            });
          },
          githubIssue: mock.githubIssue,
        },
        true,
      ),
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import GitHubLinkCard from './GitHubLinkCard.svelte';
  import LinkTooltip from './LinkTooltip.svelte';
  import { classifyGitHubLinkPreviewError, loadGitHubLinkPreview } from './github-link-preview';
  import { formatUrlForDisplay, type LinkTooltipPreview } from './link-tooltip-state.svelte';
  import {
    createLinkTooltipHandler,
    createGlobalLinkClickHandler,
  } from '$features/navigation/link-handler';
  import LinkActionMenu from '$features/navigation/LinkActionMenu.svelte';

  let {
    label,
    expected,
    url,
    client,
    interactive = false,
    resourceClient,
  }: GitHubLinkCardPreviewProps = $props();
  let linkPreview = $state<LinkTooltipPreview>({ status: 'loading' });
  let container: HTMLElement;

  onMount(() => {
    let cancelled = false;
    // Only the rate-limit scene installs the interactive client, including in the All view.
    const restoreClient = interactive ? setupHoverClient(client) : undefined;
    const stopHover = interactive ? createLinkTooltipHandler(container) : undefined;
    const stopClick = interactive ? createGlobalLinkClickHandler(container, {}) : undefined;
    const stopResource = resourceClient
      ? observeGitLabLinkPreview(
          url,
          'preview-workspace',
          (update) => {
            if (!cancelled) linkPreview = update;
          },
          resourceClient,
        )
      : undefined;
    if (!resourceClient)
      loadGitHubLinkPreview(url, { client }).then(
        (data) => {
          if (!cancelled) linkPreview = data ? { status: 'ready', data } : { status: 'idle' };
        },
        (error: unknown) => {
          if (!cancelled)
            linkPreview = { status: 'error', reason: classifyGitHubLinkPreviewError(error) };
        },
      );
    return () => {
      cancelled = true;
      stopResource?.();
      stopHover?.();
      stopClick?.();
      restoreClient?.();
    };
  });

  const cardPreview = $derived(linkPreview.status !== 'idle' ? linkPreview : null);
</script>

<!-- The import supplies shared styles; only the interactive scene mounts the singleton hosts. -->
{#if interactive}
  <LinkTooltip />
  <LinkActionMenu />
{/if}

<article bind:this={container} class="grid max-w-md gap-3" data-preview-scenario={label}>
  <div>
    <h3 class="text-sm font-semibold">{label}</h3>
    <p class="text-xs leading-5 text-muted-foreground">{expected}</p>
  </div>
  <div
    class="grid justify-items-center gap-2 bg-muted/20 p-4"
    data-preview-status={linkPreview.status}
  >
    <div class="link-tooltip link-tooltip--static" class:link-tooltip--card={cardPreview !== null}>
      {#if cardPreview}
        <GitHubLinkCard {url} preview={cardPreview} />
      {:else}
        <div class="link-tooltip-url">{formatUrlForDisplay(url)}</div>
      {/if}
      <div class="link-tooltip-hint">
        {resourceClient
          ? m.ui_linkTooltip_inAppHint_tooltip({ key: '⌘' })
          : m.ui_linkTooltip_gitHubActionsHint_tooltip({ key: '⌘' })}
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      <a href={url} class="underline" onclick={(event) => event.preventDefault()}>{url}</a>
    </p>
  </div>
</article>

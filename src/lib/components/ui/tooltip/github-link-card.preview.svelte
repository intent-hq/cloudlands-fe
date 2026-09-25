<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { appClient, MockAppClient } from '$lib/client';
  import { mockGitHubPullRequestQueued } from '$lib/client/mock/fixtures';
  import { clearGitHubLinkPreviewCache, type GitHubLinkPreviewClient } from './github-link-preview';

  export interface GitHubLinkCardPreviewProps {
    label: string;
    expected: string;
    url: string;
    client: GitHubLinkPreviewClient;
    interactive?: boolean;
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

  export const preview = definePreview<GitHubLinkCardPreviewProps>({
    id: 'github-link-card',
    title: 'GitHub link hover card',
    defaultState: 'pr-open',
    states: {
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

  let { label, expected, url, client, interactive = false }: GitHubLinkCardPreviewProps = $props();
  let linkPreview = $state<LinkTooltipPreview>({ status: 'loading' });
  let container: HTMLElement;

  onMount(() => {
    let cancelled = false;
    // Only the rate-limit scene installs the interactive client, including in the All view.
    const restoreClient = interactive ? setupHoverClient(client) : undefined;
    const stopHover = interactive ? createLinkTooltipHandler(container) : undefined;
    const stopClick = interactive ? createGlobalLinkClickHandler(container, {}) : undefined;
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
        {m.ui_linkTooltip_gitHubActionsHint_tooltip({ key: '⌘' })}
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      <a href={url} class="underline" onclick={(event) => event.preventDefault()}>{url}</a>
    </p>
  </div>
</article>

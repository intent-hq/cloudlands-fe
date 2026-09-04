<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { MockAppClient } from '$lib/client';
  import { clearGitHubLinkPreviewCache, type GitHubLinkPreviewClient } from './github-link-preview';

  export interface GitHubLinkCardPreviewProps {
    label: string;
    expected: string;
    url: string;
    client: GitHubLinkPreviewClient;
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
  ) => ({ props: { label, expected, url, client }, setup: clearGitHubLinkPreviewCache });

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
        'Falls back to the plain URL tooltip — no error copy.',
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
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import GitHubLinkCard from './GitHubLinkCard.svelte';
  import LinkTooltip from './LinkTooltip.svelte';
  import { loadGitHubLinkPreview } from './github-link-preview';
  import { formatUrlForDisplay, type LinkTooltipPreview } from './link-tooltip-state.svelte';

  let { label, expected, url, client }: GitHubLinkCardPreviewProps = $props();
  let linkPreview = $state<LinkTooltipPreview>({ status: 'loading' });

  onMount(() => {
    let cancelled = false;
    loadGitHubLinkPreview(url, { client }).then(
      (data) => {
        if (!cancelled) linkPreview = data ? { status: 'ready', data } : { status: 'idle' };
      },
      () => {
        if (!cancelled) linkPreview = { status: 'error' };
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const cardPreview = $derived(
    linkPreview.status === 'loading' || linkPreview.status === 'ready' ? linkPreview : null,
  );
</script>

<!-- Mounted (hidden) so the shared `.link-tooltip` styles are present for the inline render. -->
<LinkTooltip />

<article class="grid max-w-md gap-3" data-preview-scenario={label}>
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

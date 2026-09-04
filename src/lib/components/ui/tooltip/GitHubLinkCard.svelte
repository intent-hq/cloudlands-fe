<script lang="ts">
  /**
   * Hover-card body for a GitHub issue / PR link. Purely presentational: the
   * singleton `LinkTooltip` feeds it the loading / ready preview and the
   * sandbox scene renders the same variants without the portal.
   */
  import Fa from 'svelte-fa';
  import {
    faCircle,
    faCircleCheck,
    faCodeMerge,
    faCodePullRequest,
    type IconDefinition,
  } from '$lib/icons/phosphor-icons';
  import type { ComponentProps } from 'svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
  import type { GitHubLinkPreview } from './github-link-preview';
  import { formatUrlForDisplay } from './link-tooltip-state.svelte';

  interface Props {
    url: string;
    preview: { status: 'loading' } | { status: 'ready'; data: GitHubLinkPreview };
  }

  let { url, preview }: Props = $props();

  const ref = $derived(parseGitHubIssueOrPrUrl(url));
  const data = $derived(preview.status === 'ready' ? preview.data : null);
  const kind = $derived(data?.kind ?? ref?.kind ?? 'issue');

  interface StateStyle {
    icon: IconDefinition;
    iconClass: string;
    badge: ComponentProps<typeof Badge>['variant'];
    label: string;
  }

  const stateStyle = $derived.by((): StateStyle | null => {
    if (!data) return null;
    if (data.kind === 'pr') {
      switch (data.state) {
        case 'merged':
          return {
            icon: faCodeMerge,
            iconClass: 'text-primary',
            badge: 'default',
            label: m.ui_linkTooltip_gitHubStateMerged_label(),
          };
        case 'draft':
          return {
            icon: faCodePullRequest,
            iconClass: 'text-muted-foreground',
            badge: 'secondary',
            label: m.ui_linkTooltip_gitHubStateDraft_label(),
          };
        case 'closed':
          return {
            icon: faCodePullRequest,
            iconClass: 'text-destructive',
            badge: 'destructive',
            label: m.ui_linkTooltip_gitHubStateClosed_label(),
          };
        default:
          return {
            icon: faCodePullRequest,
            iconClass: 'text-success',
            badge: 'success',
            label: m.ui_linkTooltip_gitHubStateOpen_label(),
          };
      }
    }
    return data.state === 'closed'
      ? {
          icon: faCircleCheck,
          iconClass: 'text-primary',
          badge: 'default',
          label: m.ui_linkTooltip_gitHubStateClosed_label(),
        }
      : {
          icon: faCircle,
          iconClass: 'text-success',
          badge: 'success',
          label: m.ui_linkTooltip_gitHubStateOpen_label(),
        };
  });

  const headerIcon = $derived(stateStyle?.icon ?? (kind === 'pr' ? faCodePullRequest : faCircle));
  const owner = $derived(data?.owner ?? ref?.owner ?? '');
  const repo = $derived(data?.repo ?? ref?.repo ?? '');
  const number = $derived(data?.number ?? ref?.number ?? 0);
</script>

<div class="github-link-card" data-preview-status={preview.status} data-kind={kind}>
  <div class="github-link-card-header">
    <Fa
      icon={headerIcon}
      class="h-3 w-3 shrink-0 {stateStyle?.iconClass ?? 'text-muted-foreground'}"
    />
    <span class="github-link-card-ref">{owner}/{repo} #{number}</span>
    {#if stateStyle}
      <Badge variant={stateStyle.badge} class="github-link-card-badge ml-auto h-4 px-1.5">
        {stateStyle.label}
      </Badge>
    {/if}
  </div>

  {#if data}
    <div class="github-link-card-title">{data.title}</div>
    <div class="github-link-card-meta">
      <span class="truncate">{m.ui_linkTooltip_gitHubAuthor_label({ author: data.author })}</span>
      <span aria-hidden="true">·</span>
      <span class="shrink-0"
        >{m.ui_linkTooltip_gitHubUpdated_before()}<RelativeTime date={data.updatedAt} /></span
      >
    </div>
    {#if data.kind === 'pr'}
      <div class="github-link-card-branches">
        <span class="truncate">{data.headRef}</span>
        <span aria-hidden="true" class="shrink-0">→</span>
        <span class="truncate">{data.baseRef}</span>
      </div>
    {/if}
  {:else}
    <div
      class="github-link-card-skeleton"
      role="status"
      aria-busy="true"
      aria-label={m.ui_linkTooltip_gitHubLoading_ariaLabel()}
    >
      <Skeleton class="h-3 w-full bg-muted-foreground/20" />
      <Skeleton class="h-3 w-2/3 bg-muted-foreground/20" />
    </div>
    <div class="link-tooltip-url">{formatUrlForDisplay(url)}</div>
  {/if}
</div>

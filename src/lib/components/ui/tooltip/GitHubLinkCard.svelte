<script lang="ts">
  /**
   * Hover-card body for a GitHub issue / PR link. Purely presentational: the
   * singleton `LinkTooltip` feeds it the loading / ready / error preview and the
   * sandbox scene renders the same variants without the portal.
   */
  import Fa from 'svelte-fa';
  import {
    faCircle,
    faCircleCheck,
    faCodeMerge,
    faCodePullRequest,
    faHourglassHalf,
    type IconDefinition,
  } from '$lib/icons/phosphor-icons';
  import type { ComponentProps } from 'svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
  import { formatUrlForDisplay, type LinkTooltipPreview } from './link-tooltip-state.svelte';

  interface Props {
    url: string;
    preview: Exclude<LinkTooltipPreview, { status: 'idle' }>;
  }

  let { url, preview }: Props = $props();

  const ref = $derived(parseGitHubIssueOrPrUrl(url));
  const data = $derived(preview.status === 'ready' ? preview.data : null);
  const resource = $derived(
    'resource' in preview ? preview.resource : data && 'resource' in data ? data.resource : null,
  );
  const kind = $derived(
    data?.kind ??
      (resource?.kind === 'merge-request' ? 'pr' : resource ? 'issue' : ref?.kind) ??
      'issue',
  );

  interface StateStyle {
    icon: IconDefinition;
    iconClass: string;
    badge: ComponentProps<typeof Badge>['variant'];
    label: string;
  }

  const stateStyle = $derived.by((): StateStyle | null => {
    if (!data) return null;
    if (!['open', 'closed', 'merged', 'draft', 'queued'].includes(data.state)) {
      return {
        icon: faCircle,
        iconClass: 'text-muted-foreground',
        badge: 'secondary',
        label:
          data.state === 'locked'
            ? m.ui_linkTooltip_resourceLocked_label()
            : m.ui_linkTooltip_resourceUnknown_label(),
      };
    }
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
            iconClass: 'text-danger',
            badge: 'destructive',
            label: m.ui_linkTooltip_gitHubStateClosed_label(),
          };
        case 'queued':
          return {
            icon: faHourglassHalf,
            iconClass: 'text-info',
            badge: 'info',
            label: m.ui_linkTooltip_gitHubStateQueued_label(),
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

  // i18n-ignore (provider brand)
  const gitlabBrand = 'GitLab';

  const headerIcon = $derived(stateStyle?.icon ?? (kind === 'pr' ? faCodePullRequest : faCircle));
  const owner = $derived(data && 'owner' in data ? data.owner : (ref?.owner ?? ''));
  const repo = $derived(data && 'repo' in data ? data.repo : (ref?.repo ?? ''));
  const number = $derived(data?.number ?? resource?.number ?? ref?.number ?? 0);
</script>

<div class="github-link-card" data-preview-status={preview.status} data-kind={kind}>
  <div class="github-link-card-header">
    <Fa
      icon={headerIcon}
      class="h-3 w-3 shrink-0 {stateStyle?.iconClass ?? 'text-muted-foreground'}"
    />
    {#if resource}
      <span class="github-link-card-ref"
        >{gitlabBrand} · {kind === 'pr'
          ? m.ui_linkTooltip_resourceMergeRequest_label()
          : m.ui_linkTooltip_resourceIssue_label()}
        {kind === 'pr' ? '!' : '#'}{number}</span
      >
    {:else}
      <span class="github-link-card-ref">{owner}/{repo} #{number}</span>
    {/if}
    {#if stateStyle}
      <Badge variant={stateStyle.badge} class="ml-auto h-4 px-1.5">
        {stateStyle.label}
      </Badge>
    {/if}
  </div>
  {#if resource}
    <div class="break-all type-caption text-muted-foreground" data-testid="resource-instance">
      {resource.repository.instanceBaseUrl}
    </div>
    <div class="break-all type-caption" data-testid="resource-project">
      {resource.repository.projectPath}
    </div>
  {/if}

  {#if data}
    <div class="github-link-card-title">{data.title}</div>
    <div class="github-link-card-meta">
      {#if data.author}<span class="truncate"
          >{m.ui_linkTooltip_gitHubAuthor_label({ author: data.author })}</span
        >{/if}
      {#if data.author && data.updatedAt}<span aria-hidden="true">·</span>{/if}
      {#if data.updatedAt}<span class="shrink-0"
          >{m.ui_linkTooltip_gitHubUpdated_before()}<RelativeTime date={data.updatedAt} /></span
        >{/if}
    </div>
    {#if data.kind === 'pr' && data.headRef && data.baseRef}
      <div class="github-link-card-branches">
        <span class="truncate">{data.headRef}</span>
        <span aria-hidden="true" class="shrink-0">→</span>
        <span class="truncate">{data.baseRef}</span>
      </div>
    {/if}
  {:else if preview.status === 'error'}
    <div class="type-caption text-muted-foreground" role="status">
      {resource
        ? preview.reason === 'rate-limited'
          ? m.ui_linkTooltip_resourceRateLimited_description({ provider: gitlabBrand })
          : ['authentication', 'project-denied', 'resource-denied', 'optional-restricted'].includes(
                preview.reason,
              )
            ? m.ui_linkTooltip_resourceRestricted_description({ provider: gitlabBrand })
            : m.ui_linkTooltip_resourceUnavailable_description({ provider: gitlabBrand })
        : preview.reason === 'rate-limited'
          ? m.ui_linkTooltip_gitHubRateLimited_description()
          : m.ui_linkTooltip_gitHubUnavailable_description()}
    </div>
    <div class="link-tooltip-url">{formatUrlForDisplay(url)}</div>
  {:else}
    <div
      class="github-link-card-skeleton"
      role="status"
      aria-busy="true"
      aria-label={resource
        ? m.ui_linkTooltip_resourceLoading_ariaLabel({ provider: gitlabBrand })
        : m.ui_linkTooltip_gitHubLoading_ariaLabel()}
    >
      <Skeleton class="h-3 w-full bg-muted-foreground/20" />
      <Skeleton class="h-3 w-2/3 bg-muted-foreground/20" />
    </div>
    <div class="link-tooltip-url">{formatUrlForDisplay(url)}</div>
  {/if}
</div>

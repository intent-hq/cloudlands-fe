// Source: src/lib/components/ui/tooltip/GitHubLinkCard.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source div status regions and their block/grid layout. */
import {
  CircleIcon,
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  HourglassIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RelativeTime } from '@/components/ui/relative-time';
import { cn } from '@/lib/utils';
import { formatUrlForDisplay } from '@/lib/links/format-url-for-display';
import type { LinkTooltipPreview } from '@/lib/links/link-tooltip-types';
import { m } from '$shared/paraglide/messages.js';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import './github-link-card.css';

export interface GitHubLinkCardProps {
  url: string;
  preview: Exclude<LinkTooltipPreview, { status: 'idle' }>;
}

interface StateStyle {
  icon: Icon;
  iconClass: string;
  badge: BadgeProps['variant'];
  label: string;
}

function stateStyleFor(
  data: Extract<LinkTooltipPreview, { status: 'ready' }>['data'] | null,
): StateStyle | null {
  if (!data) return null;
  if (!['open', 'closed', 'merged', 'draft', 'queued'].includes(data.state)) {
    return {
      icon: CircleIcon,
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
          icon: GitMergeIcon,
          iconClass: 'text-primary',
          badge: 'default',
          label: m.ui_linkTooltip_gitHubStateMerged_label(),
        };
      case 'draft':
        return {
          icon: GitPullRequestIcon,
          iconClass: 'text-muted-foreground',
          badge: 'secondary',
          label: m.ui_linkTooltip_gitHubStateDraft_label(),
        };
      case 'closed':
        return {
          icon: GitPullRequestIcon,
          iconClass: 'text-danger',
          badge: 'destructive',
          label: m.ui_linkTooltip_gitHubStateClosed_label(),
        };
      case 'queued':
        return {
          icon: HourglassIcon,
          iconClass: 'text-info',
          badge: 'info',
          label: m.ui_linkTooltip_gitHubStateQueued_label(),
        };
      default:
        return {
          icon: GitPullRequestIcon,
          iconClass: 'text-success',
          badge: 'success',
          label: m.ui_linkTooltip_gitHubStateOpen_label(),
        };
    }
  }
  return data.state === 'closed'
    ? {
        icon: CheckCircleIcon,
        iconClass: 'text-primary',
        badge: 'default',
        label: m.ui_linkTooltip_gitHubStateClosed_label(),
      }
    : {
        icon: CircleIcon,
        iconClass: 'text-success',
        badge: 'success',
        label: m.ui_linkTooltip_gitHubStateOpen_label(),
      };
}

// i18n-ignore (provider brand)
const gitlabBrand = 'GitLab';

/** Pure card body. Its caller owns requests, authority, positioning and dismissal. */
export function GitHubLinkCard({ url, preview }: GitHubLinkCardProps) {
  const ref = parseGitHubIssueOrPrUrl(url);
  const data = preview.status === 'ready' ? preview.data : null;
  const resource =
    'resource' in preview ? preview.resource : data && 'resource' in data ? data.resource : null;
  const kind =
    data?.kind ??
    (resource?.kind === 'merge-request' ? 'pr' : resource ? 'issue' : ref?.kind) ??
    'issue';
  const stateStyle = stateStyleFor(data);
  const HeaderIcon = stateStyle?.icon ?? (kind === 'pr' ? GitPullRequestIcon : CircleIcon);
  const owner = data && 'owner' in data ? data.owner : (ref?.owner ?? '');
  const repo = data && 'repo' in data ? data.repo : (ref?.repo ?? '');
  const number = data?.number ?? resource?.number ?? ref?.number ?? 0;

  return (
    <div className="github-link-card" data-preview-status={preview.status} data-kind={kind}>
      <div className="github-link-card-header">
        <HeaderIcon
          weight="regular"
          aria-hidden="true"
          className={cn('h-3 w-3 shrink-0', stateStyle?.iconClass ?? 'text-muted-foreground')}
        />
        {resource ? (
          <span className="github-link-card-ref">
            {/* Match the source's single text node to preserve fractional text layout. */}
            {`${gitlabBrand} · ${
              kind === 'pr'
                ? m.ui_linkTooltip_resourceMergeRequest_label()
                : m.ui_linkTooltip_resourceIssue_label()
            } ${kind === 'pr' ? '!' : '#'}${number}`}
          </span>
        ) : (
          <span className="github-link-card-ref">
            {owner}/{repo} #{number}
          </span>
        )}
        {stateStyle && (
          <Badge variant={stateStyle.badge} className="ml-auto h-4 px-1.5">
            {stateStyle.label}
          </Badge>
        )}
      </div>
      {resource && (
        <>
          <div
            className="break-all type-caption text-muted-foreground"
            data-testid="resource-instance"
          >
            {resource.repository.instanceBaseUrl}
          </div>
          <div className="break-all type-caption" data-testid="resource-project">
            {resource.repository.projectPath}
          </div>
        </>
      )}
      {data ? (
        <>
          <div className="github-link-card-title">{data.title}</div>
          <div className="github-link-card-meta">
            {data.author && (
              <span className="truncate">
                {m.ui_linkTooltip_gitHubAuthor_label({ author: data.author })}
              </span>
            )}
            {data.author && data.updatedAt && <span aria-hidden="true">·</span>}
            {data.updatedAt && (
              <span className="shrink-0">
                {m.ui_linkTooltip_gitHubUpdated_before()}
                <RelativeTime date={data.updatedAt} />
              </span>
            )}
          </div>
          {data.kind === 'pr' && data.headRef && data.baseRef && (
            <div className="github-link-card-branches">
              <span className="truncate">{data.headRef}</span>
              <span aria-hidden="true" className="shrink-0">
                →
              </span>
              <span className="truncate">{data.baseRef}</span>
            </div>
          )}
        </>
      ) : preview.status === 'error' ? (
        <>
          <div className="type-caption text-muted-foreground" role="status">
            {resource
              ? preview.reason === 'rate-limited'
                ? m.ui_linkTooltip_resourceRateLimited_description({ provider: gitlabBrand })
                : [
                      'authentication',
                      'project-denied',
                      'resource-denied',
                      'optional-restricted',
                    ].includes(preview.reason)
                  ? m.ui_linkTooltip_resourceRestricted_description({ provider: gitlabBrand })
                  : m.ui_linkTooltip_resourceUnavailable_description({ provider: gitlabBrand })
              : preview.reason === 'rate-limited'
                ? m.ui_linkTooltip_gitHubRateLimited_description()
                : m.ui_linkTooltip_gitHubUnavailable_description()}
          </div>
          <div className="link-tooltip-url">{formatUrlForDisplay(url)}</div>
        </>
      ) : (
        <>
          <div
            className="github-link-card-skeleton"
            role="status"
            aria-busy="true"
            aria-label={
              resource
                ? m.ui_linkTooltip_resourceLoading_ariaLabel({ provider: gitlabBrand })
                : m.ui_linkTooltip_gitHubLoading_ariaLabel()
            }
          >
            <Skeleton className="h-3 w-full bg-muted-foreground/20" />
            <Skeleton className="h-3 w-2/3 bg-muted-foreground/20" />
          </div>
          <div className="link-tooltip-url">{formatUrlForDisplay(url)}</div>
        </>
      )}
    </div>
  );
}

export default GitHubLinkCard;

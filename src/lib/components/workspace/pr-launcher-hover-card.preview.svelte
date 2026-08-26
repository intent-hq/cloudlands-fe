<script lang="ts" module>
  import { PullRequestStatus, type PullRequestInfo } from '$shared/types';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { buildWorkspacePRPresentationModel } from './sidebar/workspace-pr-presentation';

  export interface PrLauncherHoverCardPreviewProps {
    mode: 'single' | 'multiple';
  }

  const timestamp = '2026-08-26T12:00:00.000Z';
  const pullRequests: PullRequestInfo[] = [
    {
      id: 'preview-pr-1373',
      number: 1373,
      url: 'https://github.com/intent-hq/cloudlands-fe/pull/1373',
      title: 'Polish sidebar pull request state and interaction details',
      status: PullRequestStatus.Open,
      ciStatus: { total: 12, passed: 9, failed: 0, pending: 3 },
      reviewDecision: 'REVIEW_REQUIRED',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'preview-pr-1374',
      number: 1374,
      url: 'https://github.com/intent-hq/cloudlands-fe/pull/1374',
      title: 'Add a compact multi-PR hover card for the Changes launcher',
      status: PullRequestStatus.Draft,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-26T13:00:00.000Z',
    },
    {
      id: 'preview-pr-1368',
      number: 1368,
      url: 'https://github.com/intent-hq/cloudlands-fe/pull/1368',
      title: 'Merge the sidebar layout foundation',
      status: PullRequestStatus.Merged,
      createdAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-08-24T12:00:00.000Z',
    },
  ];

  export const preview = definePreview<PrLauncherHoverCardPreviewProps>({
    id: 'pr-launcher-hover-card',
    title: 'PR launcher hover card',
    defaultState: 'multiple',
    states: {
      single: { props: { mode: 'single' } },
      multiple: { props: { mode: 'multiple' } },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ResourceIconTile from '$lib/components/shared/ResourceIconTile.svelte';
  import PullRequestLauncherHoverCard from './sidebar/PullRequestLauncherHoverCard.svelte';

  let { mode }: PrLauncherHoverCardPreviewProps = $props();

  const allRows = buildWorkspacePRPresentationModel({
    workspacePRs: pullRequests,
    activePR: pullRequests[0],
    monitors: [],
    workspaceRepo: 'intent-hq/cloudlands-fe',
    buildPrUrl: (_number, fallbackUrl) => fallbackUrl ?? '',
    getDisplayTitle: (pr) => pr.title,
  });
  const rows = $derived(mode === 'multiple' ? allRows : allRows.slice(0, 1));
</script>

<section
  class="flex h-[440px] w-[560px] items-end justify-end rounded-xl border border-border bg-background p-12"
  data-pr-launcher-hover-preview
>
  <div
    class="relative flex h-44 w-56 flex-col justify-between rounded-lg border border-border bg-sidebar p-2 text-foreground"
    data-sidebar-launcher="changes"
  >
    <span class="flex size-9 items-center justify-center">
      <ResourceIconTile kind="changes" variant="emphasized" />
    </span>
    <div class="flex h-7 min-w-0 items-center justify-between gap-2 pl-2">
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">Changes</span>
      <PullRequestLauncherHoverCard {rows} open={true} onOpenChange={() => {}} onOpenPr={() => {}}>
        <Button
          variant="plain"
          size="icon"
          class="size-6 shrink-0 rounded text-success"
          aria-label="View pull requests"
          data-sidebar-pr-link
        >
          <Fa icon={faCodePullRequest} class="size-4!" />
        </Button>
      </PullRequestLauncherHoverCard>
    </div>
  </div>
</section>

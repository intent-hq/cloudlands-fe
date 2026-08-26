<script lang="ts" module>
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    PREVIEW_FIXTURE_IDS,
    PREVIEW_FIXTURE_TIMESTAMPS,
    definePreviewFixture,
  } from '$lib/component-catalog/preview-fixtures';

  export interface WorkspaceSidebarPreviewProps {
    loading?: boolean;
    width: number;
    workspaces: Workspace[];
  }

  const workspaceFixture = definePreviewFixture<Workspace>({
    id: WorkspaceId(PREVIEW_FIXTURE_IDS.workspace),
    title: 'Improve frontend previews',
    branch: 'frontend-previews',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    repositoryOwner: 'intent-hq',
    repositoryName: 'cloudlands-fe',
    repositoryPath: '/repos/cloudlands-fe',
    worktreePath: '/repos/cloudlands-fe/worktrees/frontend-previews',
    ...PREVIEW_FIXTURE_TIMESTAMPS,
  });

  const busyWorkspace = workspaceFixture({
    displayStatus: 'in_progress',
    activity: 'agent_running',
    agentSummary: { agentIds: [PREVIEW_FIXTURE_IDS.agent] },
    statusMessage: 'Adding deterministic workspace and panel previews.',
  });
  const reviewWorkspace = workspaceFixture({
    id: WorkspaceId(`${PREVIEW_FIXTURE_IDS.workspace}-review`),
    title: 'Review the component catalog changes',
    branch: 'review-preview-scenes',
    displayStatus: 'needs_attention',
    attention: 'review_required',
  });
  const longWorkspace = workspaceFixture({
    id: WorkspaceId(`${PREVIEW_FIXTURE_IDS.workspace}-long`),
    title: 'A very long workspace title that confirms truncation in a narrow sidebar',
    branch: 'long-workspace-title-and-branch-for-overflow-validation',
    displayStatus: 'pr_open',
    statusMessage: 'Waiting for the last visual review before the preview work can ship.',
  });

  export const preview = definePreview<WorkspaceSidebarPreviewProps>({
    id: 'workspace-sidebar',
    title: 'Workspace sidebar',
    defaultState: 'busy',
    states: {
      loading: { props: { loading: true, width: 360, workspaces: [] } },
      empty: { props: { width: 360, workspaces: [] } },
      busy: { props: { width: 360, workspaces: [busyWorkspace, reviewWorkspace] } },
      'long-content': {
        props: { width: 420, workspaces: [longWorkspace, busyWorkspace, reviewWorkspace] },
      },
      narrow: { props: { width: 248, workspaces: [longWorkspace, busyWorkspace] } },
    },
  });
</script>

<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import SidebarSkeleton from './SidebarSkeleton.svelte';
  import WorkspaceCard from './WorkspaceCard.svelte';

  let { loading = false, width, workspaces }: WorkspaceSidebarPreviewProps = $props();
</script>

<section
  class="flex h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-sidebar text-sidebar-foreground"
  style:width={`${width}px`}
  data-workspace-sidebar-preview
  data-preview-width={width}
>
  {#if loading}
    <SidebarSkeleton />
  {:else}
    <div class="border-b border-border px-4 py-3 text-sm font-semibold">
      {m.layout_sidebarNav_allWorkspaces_title()}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-2" data-workspace-preview-list>
      {#each workspaces as workspace (workspace.id)}
        <WorkspaceCard {workspace} isPinned={workspace.id === PREVIEW_FIXTURE_IDS.workspace} />
      {:else}
        <p class="px-4 py-8 text-center text-sm text-muted-foreground" data-workspace-preview-empty>
          {m.layout_allCard_noWorkspaces_label()}
        </p>
      {/each}
    </div>
  {/if}
</section>

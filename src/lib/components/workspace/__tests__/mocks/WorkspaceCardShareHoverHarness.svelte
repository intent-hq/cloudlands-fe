<script lang="ts">
  import { untrack } from 'svelte';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  let { scenario = 'default' }: { scenario?: string } = $props();

  appStore.init();
  const workspaceId = `share-hover-${untrack(() => scenario)}`;
  const timestamp = '2026-09-14T00:00:00.000Z';
  const workspace: Workspace = {
    id: WorkspaceId(workspaceId),
    title: 'Shared workspace',
    branch: 'feat/shared',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
    statusMessage: 'Two people work here.',
    myRole: 'owner',
    memberCount: 2,
  };
  appStore.dispatch(setWorkspaceEntity(workspace));
</script>

<div
  class="flex items-start bg-sidebar p-6 text-sidebar-foreground"
  style:width="900px"
  style:height="400px"
>
  <!-- Laid out top-right, away from the row and the pointer parking spot. -->
  <!-- i18n-ignore (test fixture) -->
  <button type="button" class="order-last ml-auto self-start" data-share-hover-outside>
    Elsewhere
  </button>
  <div style:width="280px" data-share-hover-list>
    <WorkspaceCard {workspace} onClick={() => {}} />
  </div>
</div>

<script lang="ts">
  import { untrack } from 'svelte';
  import WorkspaceCard from '$lib/components/workspace/WorkspaceCard.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    selectShareDialogOpen,
    selectShareWorkspaceId,
    selectWorkspaceRosterRemovingPrincipalId,
  } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
  import {
    presenceMembersReceived,
    presenceOwnPrincipalReceived,
  } from '$store/renderer/slices/presence/presence-slice';

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
  appStore.dispatch(presenceOwnPrincipalReceived('p-alice'));
  appStore.dispatch(
    presenceMembersReceived(workspaceId, [
      {
        principalId: 'p-alice',
        login: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        role: 'owner',
        addedAt: '2026-09-01T00:00:00Z',
      },
      {
        principalId: 'p-bob',
        login: 'bob',
        displayName: null,
        avatarUrl: null,
        role: 'collaborator',
        addedAt: '2026-09-02T00:00:00Z',
      },
    ]),
  );

  const dialogOpen$ = selectShareDialogOpen();
  const dialogWorkspaceId$ = selectShareWorkspaceId();
  const people$ = selectWorkspacePresencePeople(workspaceId);
  const removingPrincipalId$ = selectWorkspaceRosterRemovingPrincipalId(workspaceId);
</script>

<output
  data-share-hover-state
  data-dialog-open={String($dialogOpen$)}
  data-dialog-workspace-id={$dialogWorkspaceId$ ?? ''}
  data-member-count={$people$.length}
  data-removing-principal-id={$removingPrincipalId$ ?? ''}
></output>
<div
  class="flex items-start bg-sidebar p-6 text-sidebar-foreground"
  style:width="900px"
  style:height="400px"
>
  <!-- First in DOM order so Tab from the row still reaches the portaled card;
       laid out top-right, away from the pointer parking spot. -->
  <!-- i18n-ignore (test fixture) -->
  <button type="button" class="order-last ml-auto self-start" data-share-hover-outside>
    Elsewhere
  </button>
  <div style:width="280px" data-share-hover-list>
    <WorkspaceCard {workspace} onClick={() => {}} />
  </div>
</div>

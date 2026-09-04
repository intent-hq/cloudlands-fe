<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceProgressCard from '../../WorkspaceProgressCard.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  const workspaceId = 'workspace-edit-geometry';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-09-04T12:00:00.000Z';

  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Geometry workspace',
      path: '/tmp/workspace-edit-geometry',
      repositoryOwner: 'intent-hq',
      repositoryName: 'intent',
      branch: 'edit-geometry',
      status: 'active',
      statusMessage: 'Geometry status message',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );

  onDestroy(disposeStore);
</script>

<section data-testid="workspace-edit-geometry-host" class="h-96 w-96 overflow-auto bg-sidebar p-6">
  <WorkspaceProgressCard {workspaceId} />
</section>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceProgressCard from '../../WorkspaceProgressCard.svelte';
  import ContextPanel from '../../ContextPanel.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  let { statusImageAssetId = undefined }: { statusImageAssetId?: string } = $props();

  const workspaceId = 'workspace-status-image';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-10-25T12:00:00.000Z';

  // svelte-ignore state_referenced_locally - fixture environment is fixed for this mount
  const assetId = statusImageAssetId;
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Status image workspace',
      path: '/tmp/workspace-status-image',
      repositoryOwner: 'intent-hq',
      repositoryName: 'intent',
      branch: 'status-image',
      status: 'active',
      statusMessage: 'Status image message',
      statusImageAssetId: assetId,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );

  onDestroy(disposeStore);
</script>

<section data-testid="workspace-status-image-host" class="w-96 bg-sidebar p-6">
  <WorkspaceProgressCard {workspaceId} />
  <section aria-label="Context">
    <ContextPanel {workspaceId} notes={[]} showAddSection={false} />
  </section>
  <div data-testid="next-sibling" class="h-10 bg-muted">Next panel</div>
</section>

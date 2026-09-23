<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceProgressCard from '../../WorkspaceProgressCard.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { fetchEditorsSuccess } from '$store/renderer/slices/external-editors/external-editors-slice';

  let { desktop = false }: { desktop?: boolean } = $props();

  const workspaceId = 'workspace-edit-geometry';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-09-04T12:00:00.000Z';

  // svelte-ignore state_referenced_locally - fixture environment is fixed for this mount
  if (desktop) {
    // Enable native UI without invoking any real desktop services.
    const originalVersion = window.electronAPI!.versions.electron;
    window.electronAPI!.versions.electron = '40.0.0';
    onDestroy(() => {
      window.electronAPI!.versions.electron = originalVersion;
    });
    store.dispatch(connectionStatusChanged('connected', { mode: 'sidecar-uds' }));
    store.dispatch(
      fetchEditorsSuccess(
        ['Visual Studio Code', 'Cursor', 'Zed', 'Terminal'].map((name, index) => ({
          id: name.toLowerCase().replaceAll(' ', '-'),
          name,
          shortLabel: name,
          appName: name,
          category: 'ide',
          handlerType: 'generic',
          priority: 100 - index,
          installed: true,
        })),
        Date.parse(timestamp),
      ),
    );
  }

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

<section
  data-testid="workspace-edit-geometry-host"
  class="h-96 w-full max-w-96 overflow-auto bg-sidebar p-6"
>
  <WorkspaceProgressCard {workspaceId} />
</section>

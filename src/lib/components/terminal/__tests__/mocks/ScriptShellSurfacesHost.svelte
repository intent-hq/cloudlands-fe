<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import WorkspaceShellList from '../../../workspace/WorkspaceShellList.svelte';
  import QuakeTerminalOverlay from '../../QuakeTerminalOverlay.svelte';
  import { makeScriptsFixture } from '../../../../../test/fixtures/scripts';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    appendScriptOutput,
    setActiveScriptsData,
    setScriptListState,
    setScriptsInitialized,
    updateRuntimeState,
  } from '$store/renderer/slices/scripts/scripts-slice';

  let { retireSelected = false }: { retireSelected?: boolean } = $props();
  const workspaceId = 'synthetic-history' as WorkspaceId;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const scripts = makeScriptsFixture();
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Script controls',
      path: '/tmp/synthetic-scripts',
      status: 'active',
      createdAt: scripts[0].createdAt,
      updatedAt: scripts[0].createdAt,
    } as never),
  );
  store.dispatch(setScriptListState(workspaceId, false, undefined, true));
  store.dispatch(setActiveScriptsData(workspaceId, scripts));
  store.dispatch(setScriptsInitialized(workspaceId, true));
  store.dispatch(
    appendScriptOutput(workspaceId, scripts[0].id, {
      text: 'Retained command output\r\n',
      timestamp: scripts[0].createdAt,
    }),
  );
  $effect(() => {
    if (!retireSelected) return;
    store.dispatch(setActiveScriptsData(workspaceId, scripts.slice(1)));
    store.dispatch(
      updateRuntimeState(workspaceId, scripts[0].id, { status: 'exited', exitCode: 0 }),
    );
  });
  onDestroy(disposeStore);
</script>

<div class="h-screen bg-background text-foreground">
  <section class="w-80 h-96 overflow-auto" aria-label="Workspace shell">
    <WorkspaceShellList {workspaceId} />
  </section>
  <QuakeTerminalOverlay {workspaceId} />
</div>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import TerminalSidebar from '../../TerminalSidebar.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setScriptsData,
    setScriptsInitialized,
  } from '$store/renderer/slices/scripts/scripts-slice';

  const workspaceId = 'terminal-edit-geometry';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const timestamp = '2026-09-04T12:00:00.000Z';

  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Terminal geometry workspace',
      path: '/tmp/terminal-edit-geometry',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(
    setScriptsData(workspaceId, [
      {
        id: 'script-geometry',
        workspaceId,
        name: 'build geometry',
        command: 'pnpm build',
        mode: 'command',
        category: 'build',
        source: 'user',
        createdAt: timestamp,
        runtime: { status: 'idle', exitCode: null, restartCount: 0 },
      },
    ]),
  );
  store.dispatch(setScriptsInitialized(workspaceId, true));

  onDestroy(disposeStore);
</script>

<section
  data-testid="terminal-edit-geometry-host"
  class="h-96 w-96 overflow-auto bg-background p-6"
>
  <TerminalSidebar {workspaceId} />
</section>

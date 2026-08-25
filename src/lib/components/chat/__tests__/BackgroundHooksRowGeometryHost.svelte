<script lang="ts">
  import { onDestroy } from 'svelte';
  import BackgroundHooksRow from '../BackgroundHooksRow.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { backgroundHooksUpdated } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import type { BackgroundHook } from '$features/hooks/background-hooks-service';

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    running = false,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    running?: boolean;
  } = $props();

  const componentId = $props.id();
  const workspaceId = `background-hooks-card-geometry-${componentId}`;
  const agentId = `background-hooks-card-agent-${componentId}`;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  $effect(() => {
    const hook: BackgroundHook = {
      hookId: 'geometry-hook',
      workspaceId,
      agentId,
      name: 'Watch deployment checks without overflowing the panel',
      delayMs: 60000,
      state: running ? 'running' : 'scheduled',
      createdAt: '2099-08-25T12:00:00.000Z',
      nextRunAt: '2099-08-25T12:10:00.000Z',
      expiresAt: '2099-08-25T13:00:00.000Z',
      runCount: 12,
    };
    store.dispatch(backgroundHooksUpdated(workspaceId, [hook]));
  });

  onDestroy(() => {
    store.dispatch(removeWorkspaceEntity(workspaceId));
    disposeStore();
  });

  const logicalWidth = $derived(width / zoom);
</script>

<section
  class:dark={theme === 'dark'}
  class="bg-background p-2 text-foreground"
  style:width="{logicalWidth}px"
  style:zoom
  data-testid="background-hooks-geometry-host"
>
  <BackgroundHooksRow {workspaceId} {agentId} />
</section>

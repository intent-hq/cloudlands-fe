<script lang="ts">
  import { onDestroy } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import type { DockContextMenuRequest, DockContextMenuResult } from '$shared/dock-context-menu';
  import { showDockContextMenu } from '$features/hud/dock-context-menu';
  import { Button } from '$lib/components/ui/button';
  import Preview from '../dock-rail.preview.svelte';
  import { dockRailPreview } from '../dock-rail.preview-fixtures';
  let { conversationFixture = false }: { conversationFixture?: boolean } = $props();
  let reactiveMachines = $state([
    { id: 'local', label: 'This Mac' },
    { id: 'remote-build', label: 'Build server' },
  ]);
  let activations = $state(0);
  let request = $state<DockContextMenuRequest | null>(null);
  let finish: ((result: DockContextMenuResult) => void) | undefined;
  const restores = [
    // eslint-disable-next-line intent/no-component-async-data-fetch -- This test-only fixture installs synthetic IPC handlers, not live domain fetches.
    overrideMockIpcHandler(WINDOW_CHANNELS.ACTIVATE_APP, () => {
      activations += 1;
      return { activated: true };
    }),
    // eslint-disable-next-line intent/no-component-async-data-fetch -- This test-only fixture installs synthetic IPC handlers, not live domain fetches.
    overrideMockIpcHandler(WINDOW_CHANNELS.SHOW_DOCK_MENU, (state) => {
      request = structuredClone(state as DockContextMenuRequest);
      return new Promise<DockContextMenuResult>((resolve) => {
        finish = resolve;
      });
    }),
  ];
  onDestroy(() => restores.forEach((restore) => restore()));
  function close(backendId?: string) {
    finish?.({ shown: true, backendId });
    request = null;
  }
</script>

<div
  data-testid="native-menu-harness"
  data-activations={activations}
  data-request={JSON.stringify(request)}
>
  <Preview
    {...dockRailPreview.states.notch.props}
    machineFixture
    controlledPlacement
    {conversationFixture}
  />
  <Button
    onclick={() => {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Exercise the native-menu bridge against the synthetic handlers installed above.
      void showDockContextMenu({ machines: reactiveMachines, currentId: 'local' });
    }}
  >
    Open menu with reactive devices
  </Button>
  {#if request}
    <aside style="position:fixed;right:20px;bottom:20px" aria-label="Native menu stand-in">
      <p>Native menu IPC is pending; no native app is connected.</p>
      <Button onclick={() => close()}>Cancel native menu</Button>
      <Button onclick={() => close('remote-build')}>Choose build server</Button>
    </aside>
  {/if}
</div>

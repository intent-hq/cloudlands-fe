<script lang="ts">
  import { onDestroy } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import type { DockContextMenuRequest, DockContextMenuResult } from '$shared/dock-context-menu';
  import { showDockContextMenu } from '$features/hud/dock-context-menu';
  import { Button } from '$lib/components/ui/button';
  import Preview from '../dock-rail.preview.svelte';
  import { dockRailPreview } from '../dock-rail.preview-fixtures';

  let {
    conversationFixture = false,
    recording = false,
    failMachineOnce = false,
    placement = 'notch',
    machines = true,
  }: {
    conversationFixture?: boolean;
    recording?: boolean;
    failMachineOnce?: boolean;
    placement?: 'notch' | 'side-left' | 'side-right';
    machines?: boolean;
  } = $props();
  let activations = $state(0);
  let requests = $state<DockContextMenuRequest[]>([]);
  let request = $state<DockContextMenuRequest | null>(null);
  let reactiveMachines = $state([
    { id: 'local', label: 'This Mac' },
    { id: 'remote-build', label: 'Build server' },
  ]);
  let finish: ((result: DockContextMenuResult) => void) | undefined;
  const restores = [
    overrideMockIpcHandler(WINDOW_CHANNELS.ACTIVATE_APP, () => {
      activations += 1;
      return { activated: true };
    }),
    overrideMockIpcHandler(WINDOW_CHANNELS.SHOW_DOCK_MENU, (payload) => {
      request = structuredClone(payload as DockContextMenuRequest);
      requests = [...requests, request];
      return new Promise<DockContextMenuResult>((resolve) => {
        finish = resolve;
      });
    }),
  ];
  onDestroy(() => {
    finish?.({ shown: false });
    restores.forEach((restore) => restore());
  });
  function close(result: DockContextMenuResult = { shown: true }) {
    const resolve = finish;
    finish = undefined;
    request = null;
    resolve?.(result);
  }
</script>

<div
  data-testid="native-menu-harness"
  data-activations={activations}
  data-requests={JSON.stringify(requests)}
  data-request={JSON.stringify(request)}
>
  <Preview
    {...dockRailPreview.states[placement].props}
    machineFixture={machines}
    controlledPlacement
    {failMachineOnce}
    {conversationFixture}
    recordingFixture={recording ? 'running' : undefined}
  />
  <Button
    onclick={() => {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Exercise structured cloning of Svelte proxies at the synthetic IPC boundary.
      void showDockContextMenu({
        machines: reactiveMachines,
        currentId: 'local',
        canTurnOff: true,
      });
    }}>Open menu with reactive devices</Button
  >
  {#if request}
    <aside class="stand-in" aria-label="Native menu IPC stand-in">
      <p><strong>Native menu IPC stand-in</strong></p>
      <p>Browser fixture only. This is not the operating system menu.</p>
      <Button onclick={() => close()}>Cancel native menu</Button>
      <Button onclick={() => close({ shown: true, backendId: 'remote-build' })}
        >Choose build server</Button
      >
      <Button onclick={() => close({ shown: true, action: 'open-intent' })}
        >Return Open Intent</Button
      >
    </aside>
  {/if}
</div>

<style>
  .stand-in {
    position: fixed;
    right: 20px;
    bottom: 20px;
    max-width: 360px;
    padding: 16px;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }
</style>

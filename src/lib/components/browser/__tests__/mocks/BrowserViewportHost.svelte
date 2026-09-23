<script lang="ts">
  import BrowserViewportMenu from '../../BrowserViewportMenu.svelte';
  import BrowserOverflowMenu from '../../BrowserOverflowMenu.svelte';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';

  let { collapsed = false }: { collapsed?: boolean } = $props();
  let viewport = $state<BrowserTabViewport>({ mode: 'fit' });
  let changes = $state(0);
  function onViewportChange(next: BrowserTabViewport) {
    viewport = next;
    changes += 1;
  }
  function noop() {}
</script>

<div data-testid="viewport-host" data-changes={changes} data-viewport={JSON.stringify(viewport)}>
  {#if collapsed}
    <BrowserOverflowMenu
      collapsed
      {viewport}
      {onViewportChange}
      onOpenExternal={noop}
      onCopyUrl={noop}
      onScreenshot={noop}
      onOpenConsole={noop}
      onOpenSource={noop}
      onOpenInspector={noop}
      onReloadWithoutCache={noop}
    />
  {:else}
    <BrowserViewportMenu {viewport} {onViewportChange} />
  {/if}
</div>

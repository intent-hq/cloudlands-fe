<script lang="ts">
  import SidebarLauncherHost from './SidebarLauncherHost.svelte';
  import MixedToolRowsHarness from '$lib/components/chat/__tests__/mocks/MixedToolRowsHarness.svelte';
  import WorkspaceViewModeToggle from '$lib/components/layout/WorkspaceViewModeToggle.svelte';
  import PanelDominantBrowserGeometryHarness from '$lib/components/layout/panel-system/__tests__/mocks/PanelDominantBrowserGeometryHarness.svelte';

  import { store } from '$store/renderer/store';

  store.init();

  let {
    scene,
    width,
    zoom,
    theme,
  }: {
    scene: 'chat' | 'sidebar' | 'tabs' | 'panel';
    width: number;
    zoom: number;
    theme: 'light' | 'dark';
  } = $props();
</script>

<main data-baseline-scene={scene} data-theme={theme} style:width={`${width}px`} style:zoom>
  {#if scene === 'sidebar'}
    <SidebarLauncherHost {width} zoom={1} {theme} />
  {:else if scene === 'chat'}
    <section class="mx-auto w-full max-w-3xl p-4" data-baseline-chat>
      <MixedToolRowsHarness />
    </section>
  {:else if scene === 'tabs'}
    <section class="flex h-12 items-center gap-2 p-2" data-baseline-tabs>
      <WorkspaceViewModeToggle />
      <button type="button" class="h-8 rounded border px-3">Panel action</button>
    </section>
  {:else}
    <PanelDominantBrowserGeometryHarness viewportWidth={width} zoomFactor={1} scenario="nested" />
  {/if}
</main>

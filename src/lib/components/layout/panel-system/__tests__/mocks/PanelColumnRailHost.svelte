<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PanelColumnCount } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import PanelColumnRail from '../../PanelColumnRail.svelte';

  let {
    theme = 'light',
    width = 500,
    zoom = 1,
    initialCount = 2,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    initialCount?: PanelColumnCount;
  } = $props();

  let count = $state<PanelColumnCount>(1);

  $effect(() => {
    count = initialCount;
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });

  onDestroy(() => document.documentElement.classList.remove('dark'));
</script>

<section
  class="relative flex h-72 overflow-hidden bg-background text-foreground"
  style:width={`${width}px`}
  style:zoom
  data-testid="panel-column-rail-host"
  data-current-count={count}
>
  <button class="absolute" type="button" data-testid="before-column-rail">Before columns</button>
  <div class="min-w-0 flex-1" data-panel-content></div>
  <PanelColumnRail {count} onCountChange={(nextCount) => (count = nextCount)} />
  <button class="absolute" type="button" data-testid="after-column-rail">After columns</button>
</section>

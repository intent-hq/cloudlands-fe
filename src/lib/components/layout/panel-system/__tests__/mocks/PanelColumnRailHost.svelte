<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
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
  <Button class="absolute" type="button" data-testid="before-column-rail">Before columns</Button>
  <div class="min-w-0 flex-1" data-panel-content></div>
  <PanelColumnRail {count} onCountChange={(nextCount) => (count = nextCount)} />
  <Button class="absolute" type="button" data-testid="after-column-rail">After columns</Button>
</section>

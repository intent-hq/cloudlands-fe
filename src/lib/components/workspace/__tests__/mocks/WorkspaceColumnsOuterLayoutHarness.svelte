<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCounterScaledTitlebarHeight } from '$lib/components/layout/titlebar-geometry';
  import { observeWorkspaceColumnsOverlap } from '../../workspace-columns-overlap';
  import { scrollWorkspaceColumnIntoView } from '../../utils/workspace-column-scroll';
  import '../../../../../routes/(app)/app-layout.css';

  let {
    count = 3,
    stacked = false,
    viewportWidth = 900,
    persistedWidth = 360,
    collapsed = false,
    theme = 'light',
    zoom = 1,
    mode = 'columns',
  }: {
    count?: number;
    stacked?: boolean;
    viewportWidth?: number;
    persistedWidth?: number;
    collapsed?: boolean;
    theme?: 'light' | 'dark';
    zoom?: number;
    mode?: 'columns' | 'tab';
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let overlap = $state(false);
  const visibleSidebarWidth = $derived(collapsed ? 0 : persistedWidth);
  const cardWidth = $derived(Math.max(280, visibleSidebarWidth) + 320);
  const stacks = $derived(
    stacked
      ? [[0, 1], ...Array.from({ length: Math.max(0, count - 2) }, (_, index) => [index + 2])]
      : Array.from({ length: count }, (_, index) => [index]),
  );

  $effect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });
  onDestroy(() => document.documentElement.classList.remove('dark'));
  onMount(() => {
    if (!scroller) return;
    return observeWorkspaceColumnsOverlap(scroller, (value) => (overlap = value)).destroy;
  });

  function revealWorkspace(workspaceIndex: number) {
    if (!scroller) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    scrollWorkspaceColumnIntoView(scroller, String(workspaceIndex), behavior, 'start');
  }
</script>

<div
  class="flex overflow-hidden bg-transparent"
  style:width={`${viewportWidth}px`}
  style:height="520px"
>
  <aside
    class="workspace-sidebar-frame relative z-40 flex shrink-0"
    class:workspace-columns-overlap={overlap}
    style:width="200px"
    style:padding-top={`${getCounterScaledTitlebarHeight(zoom)}px`}
    data-sidebar-panel-frame
  >
    <div class="h-full w-full bg-transparent" data-sidebar-panel data-global-sidebar></div>
  </aside>
  <main
    class="relative min-w-0 flex-1 {mode === 'tab'
      ? 'rounded-xl border border-border bg-sidebar shadow-sm'
      : ''}"
    style:padding-top={`${getCounterScaledTitlebarHeight(zoom)}px`}
    data-workspace-frame
    data-tab-workspace-surface={mode === 'tab' ? '' : undefined}
  >
    {#if mode === 'columns'}
      <div
        bind:this={scroller}
        class="scrollbar-none h-full w-full overflow-x-auto overflow-y-hidden bg-transparent"
        style="--workspace-reveal-inset: 0.5rem; scroll-padding-inline: var(--workspace-reveal-inset)"
        data-workspace-columns
        data-workspace-reveal-inset="8"
      >
        <div
          class="flex h-full w-max min-w-full gap-3"
          style:padding="var(--workspace-reveal-inset)"
          data-columns-track
        >
          {#each stacks as stack, stackIndex}
            <div
              class="flex h-full shrink-0 flex-col gap-2"
              style:width={`${cardWidth}px`}
              data-workspace-stack={stackIndex}
            >
              {#each stack as workspaceIndex}
                <section
                  class="relative flex min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm"
                  draggable="true"
                  data-workspace-column={workspaceIndex}
                >
                  <div
                    class="h-full bg-transparent"
                    style:width={`${visibleSidebarWidth}px`}
                    data-workspace-sidebar
                  ></div>
                  <div class="h-full min-w-0 flex-1 bg-sidebar" data-workspace-panel-canvas></div>
                </section>
              {/each}
            </div>
          {/each}
          <aside class="h-full w-90 shrink-0" data-workspace-directory-column></aside>
        </div>
      </div>
      <button class="sr-only" data-reveal-first onclick={() => revealWorkspace(0)}>first</button>
      <button class="sr-only" data-reveal-last onclick={() => revealWorkspace(count - 1)}>
        last
      </button>
    {/if}
  </main>
</div>

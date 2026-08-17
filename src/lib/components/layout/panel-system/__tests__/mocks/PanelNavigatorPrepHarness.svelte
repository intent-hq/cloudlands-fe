<script lang="ts">
  import PanelNavigator from '../../PanelNavigator.svelte';

  interface HarnessPanel {
    id: string;
    title: string;
    width: number;
  }

  let {
    viewportWidth = 400,
    zoom = 1,
    theme = 'light',
    initialPanels = [
      { id: 'chat', title: 'Chat', width: 240 },
      { id: 'note', title: 'A deliberately long note title for truncation', width: 360 },
      { id: 'browser', title: 'Browser', width: 480 },
    ],
  }: {
    viewportWidth?: number;
    zoom?: number;
    theme?: 'light' | 'dark';
    initialPanels?: HarnessPanel[];
  } = $props();

  let panels = $state<HarnessPanel[]>([]);
  let initialized = $state(false);
  let viewport = $state<HTMLElement | null>(null);
  let panelRoot = $state<HTMLElement | null>(null);
  let activationCount = $state(0);
  let lastActivated = $state('');

  $effect(() => {
    if (initialized) return;
    panels = initialPanels.map((panel) => ({ ...panel }));
    initialized = true;
  });

  function activate(panelId: string) {
    activationCount += 1;
    lastActivated = panelId;
  }

  function addPanel() {
    if (panels.some(({ id }) => id === 'extra')) return;
    panels = [...panels, { id: 'extra', title: 'Extra panel', width: 320 }];
  }

  function closeExtraPanel() {
    panels = panels.filter(({ id }) => id !== 'extra');
  }

  function reversePanels() {
    panels = [...panels].reverse();
  }

  function scrollToEnd() {
    if (!viewport) return;
    viewport.scrollLeft = viewport.scrollWidth;
    viewport.dispatchEvent(new Event('scroll'));
  }
</script>

<section
  class="bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width={`${viewportWidth}px`}
  style:zoom
  data-testid="panel-navigator-prep-host"
>
  <button type="button" data-testid="before-navigator">Before navigator</button>
  <div class="relative h-28 w-full" data-testid="panel-navigator-frame">
    <div
      bind:this={viewport}
      class="scrollbar-none h-24 w-full overflow-x-auto overflow-y-hidden"
      tabindex="-1"
      data-testid="panel-navigator-viewport"
    >
      <div bind:this={panelRoot} class="flex h-full w-max gap-2" data-testid="panel-row">
        {#each panels as panel (panel.id)}
          <article
            class="h-full shrink-0 border border-border bg-card"
            style:width={`${panel.width}px`}
            data-panel-id={panel.id}
          >
            {panel.title}
          </article>
        {/each}
      </div>
    </div>
    <PanelNavigator
      panels={panels.map(({ id, title }) => ({ id, title }))}
      {viewport}
      {panelRoot}
      ariaLabel="Panel navigator"
      onActivate={activate}
      class="absolute inset-x-0 bottom-0"
    />
  </div>
  <button type="button" data-testid="after-navigator">After navigator</button>
  <button type="button" onclick={addPanel} data-testid="add-panel">Add panel</button>
  <button type="button" onclick={closeExtraPanel} data-testid="close-panel">Close panel</button>
  <button type="button" onclick={reversePanels} data-testid="reverse-panels">Reverse panels</button>
  <button type="button" onclick={scrollToEnd} data-testid="scroll-panels">Scroll panels</button>
  <output data-testid="activation-state">{lastActivated}:{activationCount}</output>
</section>

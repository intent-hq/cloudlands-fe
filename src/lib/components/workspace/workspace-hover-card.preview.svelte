<script lang="ts" module>
  import {
    workspaceHoverCardPreview,
    workspaceHoverCardStateMatrix,
  } from './workspace-hover-card.preview-fixtures';

  export const preview = workspaceHoverCardPreview;
  export { workspaceHoverCardStateMatrix };
</script>

<script lang="ts">
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import WorkspaceHoverCard from './WorkspaceHoverCard.svelte';
  import {
    setupWorkspaceHoverCardPreviewCards,
    type WorkspaceHoverCardPreviewProps,
  } from './workspace-hover-card.preview-fixtures';
  import { onMount } from 'svelte';

  let {
    family,
    expected,
    cards,
    placement,
    layout = 'standard',
    theme,
    setupData = false,
  }: WorkspaceHoverCardPreviewProps = $props();
  let placementTrigger: HTMLDivElement | null = $state(null);
  onMount(() => (setupData ? setupWorkspaceHoverCardPreviewCards(cards) : undefined));
</script>

<section
  class="grid gap-4 {theme ?? ''}"
  data-workspace-hover-card-preview
  data-preview-family={family}
>
  <header>
    <h2 class="text-lg font-semibold">{family}</h2>
    <p class="mt-1 text-sm text-muted-foreground">{expected}</p>
  </header>

  {#if placement && cards[0]}
    <div class="relative h-[460px] min-w-[360px] border border-dashed border-border bg-muted/20">
      <div
        bind:this={placementTrigger}
        class="absolute bottom-4 right-4 w-52 bg-card px-3 py-2 text-sm shadow"
        style:anchor-name="--workspace-hover-card-preview"
      >
        {cards[0].label}
      </div>
      <HoverCard
        anchor="--workspace-hover-card-preview"
        position="right"
        anchorElement={placementTrigger}
        class="w-auto overflow-visible! rounded-lg border-0! bg-background! shadow-none!"
      >
        <WorkspaceHoverCard
          workspace={cards[0].workspace}
          isLoading={cards[0].isLoading}
          loadAgentSessions={false}
          loadWorkspaceData={false}
        />
      </HoverCard>
    </div>
  {:else}
    <div class="grid items-start gap-5">
      {#each cards as card (card.key)}
        <article class="grid min-w-0 gap-2" data-preview-scenario={card.key}>
          <div>
            <h3 class="text-sm font-semibold">{card.label}</h3>
            <p class="text-xs leading-5 text-muted-foreground">{card.expected}</p>
          </div>
          <div
            class="flex min-h-52 min-w-0 justify-center bg-muted/20 p-3 {layout === 'narrow'
              ? 'max-w-[300px]'
              : ''}"
            data-preview-layout={layout}
          >
            <WorkspaceHoverCard
              workspace={card.workspace}
              isLoading={card.isLoading}
              lineStats={card.lineStats}
              activeAgentIds={card.activeAgentIds ?? []}
              loadAgentSessions={false}
              loadWorkspaceData={false}
            />
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

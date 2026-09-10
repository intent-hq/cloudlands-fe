<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { GraphNode } from './types';

  export interface GraphNodeRecentEvent {
    id: string;
    label: string;
    timestamp: string;
  }

  interface Props {
    node: GraphNode;
    events: GraphNodeRecentEvent[];
    onOpen: (event: MouseEvent) => void;
    onFitCluster: () => void;
  }

  let { node, events, onOpen, onFitCluster }: Props = $props();
  const title = $derived(
    node.type === 'agent' ? node.name : node.type === 'file' ? node.fileName : node.title,
  );
</script>

<aside
  class="absolute right-4 top-4 z-10 w-[280px] max-w-[calc(100%-2rem)] rounded-md border border-border bg-card text-card-foreground shadow-lg"
  aria-label={title}
  data-graph-node-detail
  data-graph-controls
>
  <div class="border-b border-border px-3 py-2.5">
    <h2 class="truncate text-sm font-semibold">{title}</h2>
    <p class="type-caption mt-0.5 text-muted-foreground">
      {m.layout_commandPalette_recent_group()}
    </p>
  </div>
  <div class="max-h-44 overflow-y-auto px-3 py-2">
    {#if events.length === 0}
      <p class="text-xs text-muted-foreground">
        {m.workspace_hoverCard_noRecentActivity_label()}
      </p>
    {:else}
      <ul class="space-y-2">
        {#each events as event (event.id)}
          <li class="flex min-w-0 items-baseline justify-between gap-2 text-xs">
            <span class="min-w-0 truncate">{event.label}</span>
            <RelativeTime class="shrink-0 text-muted-foreground" date={event.timestamp} compact />
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <div class="flex justify-end gap-1.5 border-t border-border px-3 py-2">
    <Button variant="ghost-light" size="xs" onclick={onOpen}>
      {m.ui_openCombo_open_label()}
    </Button>
    <Button variant="default" size="xs" onclick={onFitCluster}>
      {m.agentOverview_nodeDetail_fitCluster_label()}
    </Button>
  </div>
</aside>

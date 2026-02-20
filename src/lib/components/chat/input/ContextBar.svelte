<script lang="ts">
  import type { ContextItem } from './context-api';

  interface Props {
    items: ContextItem[];
    onRemove: (id: string) => void;
  }

  let { items = [], onRemove } = $props();

  // Color mapping for different types
  const colorMap: Record<string, string> = {
    file: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    folder: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    note: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    workspace: 'bg-green-500/10 text-green-600 border-green-500/20',
    symbol: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
    selection: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    memory: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    personality: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  };

  function getItemColor(item: ContextItem) {
    return colorMap[item.type] || colorMap.file;
  }

  function formatLabel(item: ContextItem): string {
    if (item.type === 'file' && item.path) {
      // Show just the filename for files
      const parts = item.path.split('/');
      return parts[parts.length - 1];
    }
    return item.label;
  }

  function getTooltip(item: ContextItem): string {
    if (item.path) {
      return item.path;
    }
    if (item.type === 'selection' && item.content) {
      return item.content.substring(0, 200) + (item.content.length > 200 ? '...' : '');
    }
    return item.label;
  }
</script>

{#if items.length > 0}
  <div class="bg-muted/50 -mx-2 -mt-2 mb-0 px-2 py-1 flex items-center justify-between">
    <div class="flex flex-wrap gap-1 flex-1">
      {#each items as item (item.id)}
        <div
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border {getItemColor(
            item,
          )}"
          title={getTooltip(item)}
        >
          <!-- Icon based on type -->
          {#if item.type === 'file'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" />
            </svg>
          {:else if item.type === 'folder'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M2 2a1 1 0 0 1 1-1h3.5l1 1H13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2z"
              />
            </svg>
          {:else if item.type === 'note'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M3 0h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5l-4 3v-3H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"
              />
            </svg>
          {:else if item.type === 'workspace'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1L2 4v5l6 3 6-3V4L8 1z" />
            </svg>
          {:else if item.type === 'symbol'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 5v6h3v-1H3V6h2V5H2zm9 0v1h2v4h-2v1h3V5h-3z" />
            </svg>
          {:else if item.type === 'selection'}
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2h10v2H3V2zm0 4h10v2H3V6zm0 4h7v2H3v-2z" />
            </svg>
          {/if}

          <span>{formatLabel(item)}</span>

          {#if item.range}
            <span class="opacity-60">
              L{item.range.start}-{item.range.end}
            </span>
          {/if}

          <button
            class="ml-1 -mr-1 p-0.5 hover:bg-black/10 rounded transition-colors"
            onclick={() => onRemove(item.id)}
            aria-label="Remove context"
          >
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"
              />
            </svg>
          </button>
        </div>
      {/each}
    </div>
    <div class="text-xs text-muted-foreground ml-2">
      {items.length}
      {items.length === 1 ? 'item' : 'items'}
    </div>
  </div>
{/if}

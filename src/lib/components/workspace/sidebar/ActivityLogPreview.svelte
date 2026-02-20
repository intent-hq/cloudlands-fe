<script lang="ts">
  import type { WorkspaceEvent } from '$features/events/types';
  import { getActivityTitle, getActivityIcon } from './utils';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    events?: WorkspaceEvent[];
    maxItems?: number;
    onOpenEvent?: (event: WorkspaceEvent) => void;
    onViewAll?: () => void;
  }

  let { events = [], maxItems = 2, onOpenEvent, onViewAll }: Props = $props();

  // Deduplicate events by ID to prevent Svelte {#each} key errors
  const displayedEvents = $derived.by(() => {
    const seen = new Set<string>();
    const deduped: WorkspaceEvent[] = [];
    for (const event of events) {
      if (event.id && !seen.has(event.id)) {
        seen.add(event.id);
        deduped.push(event);
      }
    }
    return deduped.slice(0, maxItems);
  });
</script>

{#if displayedEvents.length > 0 || onViewAll}
  <div class="shrink-0 mt-auto">
    <div class="px-4 py-3">
      {#if displayedEvents.length > 0}
        <!-- Sleek timeline -->
        <div class="relative">
          <!-- Timeline line -->
          <div class="absolute left-1.5 top-2 -bottom-1.5 w-px bg-border"></div>

          <div class="space-y-0">
            {#each displayedEvents as event (event.id)}
              {@const icon = getActivityIcon(event)}
              {@const title = getActivityTitle(event)}
              <button
                type="button"
                class="group relative flex items-start gap-3 w-full text-left py-1 pl-0 pr-2 rounded-md hover:bg-muted/30 transition-colors"
                onclick={() => onOpenEvent?.(event)}
              >
                <!-- Content -->
                <div class="flex-1 min-w-0 flex items-center gap-1.5">
                  <div class="bg-sidebar py-0.5">
                    <Fa {icon} size="xs" class="text-muted-foreground/40 shrink-0 w-3.5" />
                  </div>
                  <span
                    class="text-[0.82rem] truncate text-muted-foreground/60 group-hover:text-foreground transition-colors"
                  >
                    {title}
                  </span>
                </div>

                <!-- Time -->
                <span class="text-[10px] text-muted-foreground/50 shrink-0">
                  <RelativeTime date={event.timestamp} compact />
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if onViewAll}
        <button
          type="button"
          class="w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-1.5 flex items-center gap-1 cursor-pointer"
          onclick={() => onViewAll?.()}
        >
          <Fa icon={faPlus} size="xs" class="text-muted-foreground/50 shrink-0 w-3.5 mr-0.5" />
          <div class="flex-1 text-left text-[0.82rem]">See all activity</div>
        </button>
      {/if}
    </div>
  </div>
{/if}

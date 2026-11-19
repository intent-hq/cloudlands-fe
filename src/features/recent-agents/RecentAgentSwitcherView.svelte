<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { recentAgentKey, type RecentAgentEntry } from '$shared/recent-agents';
  import RecentAgentCard from './RecentAgentCard.svelte';

  interface Props {
    entries: RecentAgentEntry[];
    selectedIndex: number;
    /** This window's machine: its entries show live status. */
    currentConnectionId: string;
    isOffline: (entry: RecentAgentEntry) => boolean;
    onpoint: (index: number) => void;
    onchoose: (index: number) => void;
    listbox?: HTMLElement | null;
  }

  let {
    entries,
    selectedIndex,
    currentConnectionId,
    isOffline,
    onpoint,
    onchoose,
    listbox = $bindable(null),
  }: Props = $props();

  const optionId = (index: number) => `recent-agent-option-${index}`;

  $effect(() => {
    if (selectedIndex < 0) return;
    document
      .getElementById(optionId(selectedIndex))
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div
  class="pointer-events-none fixed inset-0 z-[var(--layer-modal)] flex items-center justify-center p-6"
  data-recent-agent-switcher
>
  <div
    bind:this={listbox}
    role="listbox"
    tabindex="-1"
    aria-label={m.recentAgents_switcher_ariaLabel()}
    aria-orientation="horizontal"
    aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
    class="overlay-surface pointer-events-auto flex max-w-full gap-2 overflow-x-auto bg-popover p-2 text-popover-foreground outline-none"
  >
    {#each entries as entry, index (recentAgentKey(entry))}
      <RecentAgentCard
        {entry}
        id={optionId(index)}
        selected={index === selectedIndex}
        local={entry.connectionId === currentConnectionId}
        offline={isOffline(entry)}
        onpoint={() => onpoint(index)}
        onchoose={() => onchoose(index)}
      />
    {/each}
  </div>
</div>

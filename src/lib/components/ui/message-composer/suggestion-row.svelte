<script lang="ts">
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import ArrowElbowDownLeftIcon from 'phosphor-svelte/lib/ArrowElbowDownLeftIcon';
  import { proximityItem, type ProximityHover } from '$lib/interaction';
  import { cn } from '$lib/utils.js';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { menuItem } from '$lib/components/ui/menu';

  let {
    text,
    index,
    active,
    keyHint,
    shortcut,
    optionId,
    hover,
    compact = false,
    onSelect,
  }: {
    text: string;
    index: number;
    active: boolean;
    keyHint: boolean;
    shortcut?: string;
    optionId: string;
    hover: ProximityHover;
    compact?: boolean;
    onSelect: () => void;
  } = $props();
</script>

<div
  use:proximityItem={{ hover, index }}
  id={optionId}
  role="option"
  tabindex="-1"
  aria-selected={active}
  onclick={onSelect}
  onkeydown={(event) => event.key === 'Enter' && onSelect()}
  class={cn(menuItem(), 'cursor-pointer px-2.5 text-muted-foreground')}
  class:h-7={compact}
  class:h-8={!compact}
  class:text-[13px]={compact}
  class:text-sm={!compact}
  class:text-foreground={active}
>
  <span class="min-w-0 flex-1 truncate">{text}</span>
  {#if shortcut}
    <span
      class="inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-border bg-background px-1"
    >
      <ShortcutChip>{shortcut}</ShortcutChip>
    </span>
  {/if}
  {#if !active && keyHint}
    <ArrowDownIcon size={13} class="shrink-0 opacity-70" aria-hidden="true" />
  {:else}
    <ArrowElbowDownLeftIcon
      size={13}
      class={cn(
        'shrink-0 transition-opacity duration-spring-fast',
        active ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    />
  {/if}
</div>

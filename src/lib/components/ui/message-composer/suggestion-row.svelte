<script lang="ts">
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import ArrowElbowDownLeftIcon from 'phosphor-svelte/lib/ArrowElbowDownLeftIcon';
  import { proximityItem, type ProximityHover } from '$lib/interaction';
  import { cn } from '$lib/utils.js';

  let {
    text,
    index,
    active,
    keyHint,
    optionId,
    hover,
    compact = false,
    onSelect,
  }: {
    text: string;
    index: number;
    active: boolean;
    keyHint: boolean;
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
  class="relative z-10 flex cursor-pointer items-center gap-2 px-2.5 text-muted-foreground transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none"
  class:h-7={compact}
  class:h-8={!compact}
  class:text-[13px]={compact}
  class:text-sm={!compact}
  class:text-foreground={active}
>
  <span class="min-w-0 flex-1 truncate">{text}</span>
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

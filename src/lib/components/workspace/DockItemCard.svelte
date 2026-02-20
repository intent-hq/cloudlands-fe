<script lang="ts">
  import { cn } from '$lib/utils';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Fa } from 'svelte-fa';
  import { faTerminal, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { formatRelativeTime } from '$shared/utils-client';

  interface Props {
    id: string;
    type: 'agent' | 'terminal';
    name: string;
    subtitle?: string;
    createdAt?: string;
    isSelected?: boolean;
    isStacked?: boolean;
    isResponding?: boolean;
    hasUnread?: boolean;
    isBackground?: boolean;
    showChevron?: boolean;
    onClick?: () => void;
    onChevronClick?: () => void;
    class?: string;
    /** Specialist type to show tool icon overlay on avatar */
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
  }

  let {
    id,
    type,
    name,
    subtitle = '',
    createdAt,
    isSelected = false,
    isStacked = false,
    isResponding = false,
    hasUnread = false,
    isBackground = false,
    showChevron = false,
    onClick,
    onChevronClick,
    class: className = '',
    specialist = null,
  }: Props = $props();

  function handleClick(e: MouseEvent) {
    onClick?.();
  }

  function handleChevronClick(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    onChevronClick?.();
  }
</script>

<button
  class={cn(
    'relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer text-left',
    'bg-background border border-border/50',
    'hover:bg-muted/50 hover:border-border',
    isSelected && 'bg-muted border-border shadow-sm',
    isStacked && 'opacity-60 scale-[0.98] translate-y-1',
    className,
  )}
  onclick={handleClick}
>
  <!-- Chevron for back to overview -->
  {#if showChevron}
    <div
      role="button"
      tabindex="0"
      class="flex-none flex items-center justify-center w-5 h-5 -ml-1 rounded hover:bg-muted-foreground/10 transition-colors"
      onclick={handleChevronClick}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleChevronClick(e); }}
      aria-label="Back to overview"
    >
      <Fa icon={faChevronDown} size="xs" class="text-muted-foreground rotate-180" />
    </div>
  {/if}

  <!-- Icon/Avatar -->
  <div class="flex-none relative">
    {#if type === 'agent'}
      <AuggieAvatar
        size={32}
        colorSeed={id}
        faceSeed={id}
        class={cn(isResponding && 'animate-pulse')}
        {specialist}
      />
      {#if isResponding}
        <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse border-2 border-background"></div>
      {:else if hasUnread}
        <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full border-2 border-background"></div>
      {/if}
      {#if isBackground}
        <div class="absolute -top-1 -right-1 px-1 py-0.5 text-[7px] font-bold bg-muted text-muted-foreground rounded">
          BG
        </div>
      {/if}
    {:else}
      <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
        <Fa icon={faTerminal} size="sm" class="text-muted-foreground" />
      </div>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="font-medium text-sm truncate">{name}</div>
    {#if subtitle}
      <div class="text-xs text-muted-foreground truncate">{subtitle}</div>
    {/if}
  </div>

  <!-- Timestamp -->
  {#if createdAt}
    <div class="flex-none text-xs text-muted-foreground">
      {formatRelativeTime(createdAt)}
    </div>
  {/if}
</button>

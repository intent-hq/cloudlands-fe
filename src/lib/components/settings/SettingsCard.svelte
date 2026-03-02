<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';

  interface Props {
    title: string;
    description?: string;
    expanded?: boolean;
    onToggle?: () => void;
    badges?: { label: string; variant: 'default' | 'primary' | 'warning' }[];
    /** Right side content shown when collapsed (e.g., model badge) */
    preview?: Snippet;
    /** Icon/avatar area */
    icon?: Snippet;
    /** Expanded content */
    children?: Snippet;
  }

  let {
    title,
    description,
    expanded = false,
    onToggle,
    badges = [],
    preview,
    icon,
    children,
  }: Props = $props();

  function getBadgeClass(variant: 'default' | 'primary' | 'warning'): string {
    switch (variant) {
      case 'primary':
        return 'bg-primary/10 text-primary';
      case 'warning':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
      default:
        return 'bg-muted text-subtle';
    }
  }
</script>

<div
  class="group border transition-all duration-200 {expanded
    ? 'border-border bg-card shadow-sm'
    : 'border-transparent hover:border-border/50 hover:bg-muted/30'}"
>
  <!-- Card Header -->
  <button
    type="button"
    onclick={onToggle}
    class="w-full flex gap-3 p-4 text-left transition-colors cursor-pointer"
  >
    <!-- Icon -->
    {#if icon}
      <div class="shrink-0 flex flex-col mt-0.75 h-auto text-subtle">
        {@render icon()}
      </div>
    {/if}

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-medium text-foreground">{title}</span>
        {#each badges as badge}
          <span
            class="inline-flex items-center text-ui px-2 py-0.5 rounded-full font-medium {getBadgeClass(
              badge.variant,
            )}"
          >
            {badge.label}
          </span>
        {/each}
      </div>
      {#if description}
        <p class="text-sm text-subtle mt-0.5 line-clamp-1">{description}</p>
      {/if}
    </div>

    <!-- Preview (visible when collapsed) -->
    {#if !expanded && preview}
      <div
        class="hidden pt-0.75 sm:flex flex-col items-center gap-2 text-xs text-subtle"
        transition:slide={{ axis: 'y', duration: 200 }}
      >
        {@render preview()}
      </div>
    {/if}

    <!-- Chevron -->
    <div
      class="shrink-0 mt-1.25 origin-center h-fit text-subtle transition-transform duration-200 {expanded
        ? 'rotate-90'
        : ''}"
    >
      <Fa icon={faChevronRight} size={10} />
    </div>
  </button>

  <!-- Expanded Panel -->
  {#if expanded && children}
    <div
      class="px-4 pb-4 pt-0 space-y-5 animate-in fade-in slide-in-from-top-1 duration-200"
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      <div class="h-px bg-border/50"></div>
      {@render children()}
    </div>
  {/if}
</div>

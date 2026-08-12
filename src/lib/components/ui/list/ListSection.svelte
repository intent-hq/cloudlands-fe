<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Button from '../button/button.svelte';
  import { slide } from 'svelte/transition';
  import Header from '../Header.svelte';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    title?: string;
    titleClass?: string;
    contentClass?: string;
    icon?: any; // FontAwesome icon
    actionIcon?: any; // FontAwesome icon for action button
    actionLabel?: string;
    onAction?: () => void;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    children?: any;
    actions?: any; // Snippet for custom actions
  }

  let {
    class: className,
    title,
    titleClass,
    contentClass,
    icon,
    actionIcon,
    actionLabel,
    onAction,
    collapsible = false,
    collapsed = false,
    onToggleCollapse,
    children,
    actions,
    ...restProps
  }: Props = $props();

  function handleToggle() {
    if (collapsible && onToggleCollapse) {
      onToggleCollapse();
    }
  }
</script>

<div data-slot="list-section" class={cn('flex min-w-0 flex-col', className)} {...restProps}>
  {#if title}
    {#if collapsible}
      <div
        class={cn(
          'group type-caption flex min-h-7 items-center rounded-md border border-transparent font-medium text-muted-foreground',
          'hover:bg-accent/60 hover:text-accent-foreground',
          titleClass,
        )}
      >
        <button
          type="button"
          class="flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
          onclick={handleToggle}
          aria-expanded={!collapsed}
        >
          {#if icon}
            <Fa {icon} size="12" class="text-muted-foreground/50" />
          {/if}
          <Header size={6} class="flex-1 text-left">{title}</Header>
          <Fa
            icon={faChevronDown}
            size="13"
            class={cn(
              'text-muted-foreground/50 transition-transform duration-[var(--motion-standard)] motion-reduce:transition-none' /* a11y-ignore */,
              collapsed && 'rotate-90',
            )}
          />
        </button>
        <div class="flex shrink-0 items-center gap-1 pr-1">
          {#if actions}
            {@render actions()}
          {:else if actionIcon && onAction}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onclick={(e) => {
                e.stopPropagation();
                onAction();
              }}
              title={actionLabel}
            >
              <Fa icon={actionIcon} size="15" />
            </Button>
          {/if}
        </div>
      </div>
    {:else}
      <div
        class={cn(
          'group mb-1 flex min-h-7 items-center justify-between gap-2 px-2 py-1',
          'type-caption font-medium text-muted-foreground',
          titleClass,
        )}
      >
        <span class="a11y-ignore type-caption flex-1 text-left font-medium text-muted-foreground"
          >{title}</span
        >

        <div class="flex items-center gap-1">
          {#if actions}
            {@render actions()}
          {:else if actionIcon && onAction}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onclick={(e) => {
                e.stopPropagation();
                onAction();
              }}
              title={actionLabel}
            >
              <Fa icon={actionIcon} size="15" />
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}

  {#if !collapsed}
    <div
      data-slot="list-section-content"
      class={cn('flex min-w-0 flex-col', contentClass)}
      transition:slide={{ duration: 150 }}
    >
      {@render children?.()}
    </div>
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    [data-slot='list-section-content'] {
      transition-duration: 0ms !important;
    }
  }
</style>

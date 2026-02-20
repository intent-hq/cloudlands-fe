<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLAttributes } from 'svelte/elements';
  import Fa from 'svelte-fa';
  import Button from '../button/button.svelte';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
    title?: string;
    titleClass?: string;
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

<div class={cn('flex flex-col', className)} {...restProps}>
  {#if title}
    {#if collapsible}
      <button
        type="button"
        class={cn(
          'flex items-center justify-between px-2 py-0 mb-1 group',
          'text-xs font-medium text-muted-foreground',
          'cursor-pointer hover:text-foreground',
          titleClass,
        )}
        onclick={handleToggle}
      >
        <div class="flex items-center gap-1.5">
          <Fa
            icon={icon || 'chevron-right'}
            size="14"
            class={cn(
              'text-muted-foreground/50 transition-transform duration-200',
              !collapsed && 'rotate-90',
            )}
          />
          <span>{title}</span>
        </div>

        <div class="flex items-center gap-1">
          {#if actions}
            {@render actions()}
          {:else if actionIcon && onAction}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="opacity-0 group-hover:opacity-100 transition-opacity"
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
      </button>
    {:else}
      <div
        class={cn(
          'flex items-center justify-between px-2 py-0 mb-1 group',
          'text-xs font-medium text-muted-foreground',
          titleClass,
        )}
      >
        <div class="flex items-center gap-1.5">
          {#if icon}
            <Fa {icon} size="14" class="text-muted-foreground/50" />
          {/if}
          <span>{title}</span>
        </div>

        <div class="flex items-center gap-1">
          {#if actions}
            {@render actions()}
          {:else if actionIcon && onAction}
            <Button
              variant="ghost-light"
              size="icon-xs"
              class="opacity-0 group-hover:opacity-100 transition-opacity"
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
    <div class="flex flex-col">
      {@render children?.()}
    </div>
  {/if}
</div>

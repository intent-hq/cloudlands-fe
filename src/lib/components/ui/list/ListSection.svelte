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

<div class={cn('flex flex-col', className)} {...restProps}>
  {#if title}
    {#if collapsible}
      <button
        type="button"
        class={cn(
          'flex items-center justify-between px-2 py-0 gap-1 group',
          'text-xs font-medium text-muted-foreground',
          'cursor-pointer hover:text-foreground',
          titleClass,
        )}
        onclick={handleToggle}
      >
        <div class="flex items-center gap-1.5 flex-1">
          {#if icon}
            <Fa {icon} size="12" class="text-muted-foreground/50" />
          {/if}
          <Header size={6} class="flex-1 text-left">{title}</Header>
        </div>

        <div class="flex items-center gap-1">
          {#if actions}
            <div class="flex items-center" onclick={(e) => e.stopPropagation()}>
              {@render actions()}
            </div>
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

        <Fa
          icon={faChevronDown}
          size={13}
          class={cn(
            'text-muted-foreground/50 transition-transform duration-200', /* a11y-ignore */
            collapsed && 'rotate-90',
          )}
        />
      </button>
    {:else}
      <div
        class={cn(
          'flex items-center justify-between px-2 py-0 mb-1 group',
          'text-xs font-medium text-subtle',
          titleClass,
        )}
      >
        <span
          class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex-1 text-left a11y-ignore"
          >{title}</span
        >

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
    <div class={cn('flex flex-col', contentClass)} transition:slide={{ duration: 150 }}>
      {@render children?.()}
    </div>
  {/if}
</div>

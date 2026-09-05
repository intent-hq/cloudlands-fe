<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { RowAction } from './types';

  let {
    actions = [],
    overflowActions = [],
    overflow,
    overflowLabel,
    alwaysVisible = false,
    class: className,
  }: {
    actions?: readonly RowAction[];
    overflowActions?: readonly RowAction[];
    overflow?: Snippet;
    overflowLabel?: string;
    alwaysVisible?: boolean;
    class?: string;
  } = $props();
  let focused = $state(false);
</script>

<div
  data-slot="row-actions"
  data-revealed={alwaysVisible || focused || undefined}
  class={cn(
    'flex items-center gap-1 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none',
    !alwaysVisible &&
      'opacity-0 group-hover/collection-row:opacity-100 group-focus-within/collection-row:opacity-100 focus-within:opacity-100',
    className,
  )}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focused = false;
  }}
>
  {#each actions as action (action.label)}
    <Button
      variant={action.destructive ? 'destructive' : 'ghost-light'}
      size="icon-xs"
      iconOnly
      aria-label={action.label}
      disabled={action.disabled}
      onclick={(event) => {
        event.stopPropagation();
        action.onSelect();
      }}
    >
      {@render action.icon()}
    </Button>
  {/each}
  {#if overflow}
    {@render overflow()}
  {:else if overflowActions.length > 0 && overflowLabel}
    <Menu.Root>
      <Menu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost-light"
            size="icon-xs"
            iconOnly
            aria-label={overflowLabel}
          >
            <span aria-hidden="true">•••</span>
          </Button>
        {/snippet}
      </Menu.Trigger>
      <Menu.Content align="end">
        {#each overflowActions as action (action.label)}
          <Menu.Item
            destructive={action.destructive}
            disabled={action.disabled}
            onclick={() => action.onSelect()}
          >
            {@render action.icon()}
            {action.label}
          </Menu.Item>
        {/each}
      </Menu.Content>
    </Menu.Root>
  {/if}
</div>

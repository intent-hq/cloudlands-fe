<script lang="ts">
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import ActionMenu from './ActionMenu.svelte';
  import { splitActions } from './actions';
  import type { ActionDefinition, ActionHandler } from './types';

  let {
    actions,
    onAction,
    visibleCount = Number.POSITIVE_INFINITY,
    overflowLabel,
    class: className,
  }: {
    actions: readonly ActionDefinition[];
    onAction?: ActionHandler;
    visibleCount?: number;
    overflowLabel: string;
    class?: string;
  } = $props();

  const split = $derived(splitActions(actions, visibleCount));
</script>

<div data-slot="action-bar" class={cn('flex items-center gap-1', className)}>
  {#each split.visible as action (action.id)}
    {#if action.icon}
      <Button
        variant={action.destructive ? 'destructive' : 'ghost-light'}
        size="icon-xs"
        iconOnly
        aria-label={action.label}
        aria-pressed={action.checked === undefined ? undefined : action.checked}
        active={action.checked}
        disabled={action.disabled || action.disabledReason !== undefined}
        tooltip={action.disabledReason ?? action.label}
        tooltipShortcut={action.shortcut}
        onclick={(event) => onAction?.(action.id, event)}
        data-action-id={action.id}
      >
        <Fa icon={action.icon} size="xs" />
      </Button>
    {:else}
      <Button
        variant={action.destructive ? 'destructive' : 'ghost-light'}
        size="xs"
        aria-label={action.label}
        aria-pressed={action.checked === undefined ? undefined : action.checked}
        active={action.checked}
        disabled={action.disabled || action.disabledReason !== undefined}
        tooltip={action.disabledReason ?? action.label}
        tooltipShortcut={action.shortcut}
        onclick={(event) => onAction?.(action.id, event)}
        data-action-id={action.id}
      >
        {action.label}
      </Button>
    {/if}
  {/each}

  {#if split.overflow.length > 0}
    <ActionMenu actions={split.overflow} {onAction} ariaLabel={overflowLabel} align="end">
      {#snippet trigger({ props })}
        <Button {...props} variant="ghost-light" size="icon-xs" iconOnly aria-label={overflowLabel}>
          <span aria-hidden="true">•••</span>
        </Button>
      {/snippet}
    </ActionMenu>
  {/if}
</div>

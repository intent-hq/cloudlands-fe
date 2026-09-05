<script module lang="ts">
  import { Button } from '$lib/components/ui/button';
  let closeActiveMenu: (() => void) | null = null;
</script>

<script lang="ts">
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import * as Menu from '$lib/components/ui/menu';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, type Snippet } from 'svelte';
  import { resolveActions } from './actions';
  import type { ActionDefinition, ActionHandler } from './types';

  let {
    actions,
    onAction,
    trigger,
    contextMenu,
    ariaLabel,
    open = $bindable(false),
    align = 'start',
    side = 'bottom',
    class: className,
  }: {
    actions: readonly ActionDefinition[];
    onAction?: ActionHandler;
    trigger?: Snippet<[{ props: Record<string, unknown>; open: boolean }]>;
    contextMenu?: { x: number; y: number };
    ariaLabel: string;
    open?: boolean;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    class?: string;
  } = $props();

  const resolvedActions = $derived(resolveActions(actions));
  let initializedContextMenu = false;

  $effect(() => {
    if (!contextMenu || initializedContextMenu) return;
    initializedContextMenu = true;
    open = true;
  });

  function select(action: ActionDefinition, event: Event) {
    if (action.disabled || action.disabledReason !== undefined) return;
    onAction?.(action.id, event);
  }

  function close() {
    open = false;
  }

  $effect(() => {
    if (!open) {
      if (closeActiveMenu === close) closeActiveMenu = null;
      return;
    }
    const previousClose = closeActiveMenu;
    closeActiveMenu = close;
    if (previousClose && previousClose !== close) previousClose();
  });

  onDestroy(() => {
    if (closeActiveMenu === close) closeActiveMenu = null;
  });
</script>

{#snippet itemContent(action: ActionDefinition)}
  {#if action.icon}
    <Fa icon={action.icon} size="xs" class="w-4 shrink-0 text-muted-foreground opacity-70" />
  {/if}
  <span class="min-w-0 flex-1 truncate">{action.label}</span>
  {#if action.checked}
    <Fa icon={faCheck} size="xs" class="w-4 shrink-0 text-muted-foreground opacity-70" />
  {/if}
  {#if action.shortcut}
    <span class="ml-5" aria-hidden="true"><ShortcutChip>{action.shortcut}</ShortcutChip></span>
  {/if}
{/snippet}

{#snippet actionItem(action: ActionDefinition)}
  {@const disabled = action.disabled || action.disabledReason !== undefined}
  {#if action.children?.length}
    <Menu.Sub>
      <Menu.SubTrigger {disabled}>
        {@render itemContent(action)}
      </Menu.SubTrigger>
      <Menu.SubContent>
        {@render actionItems(action.children)}
      </Menu.SubContent>
    </Menu.Sub>
  {:else}
    <Menu.Item
      {disabled}
      destructive={action.destructive}
      onSelect={(event) => select(action, event)}
      data-action-id={action.id}
    >
      {@render itemContent(action)}
    </Menu.Item>
  {/if}
{/snippet}

{#snippet renderedItem(action: ActionDefinition)}
  {#if action.disabledReason}
    <Tooltip content={action.disabledReason} side="right">
      {#snippet trigger()}
        {@render actionItem(action)}
      {/snippet}
    </Tooltip>
  {:else}
    {@render actionItem(action)}
  {/if}
{/snippet}

{#snippet actionItems(entries: readonly ActionDefinition[])}
  {#each entries as action, index (action.id)}
    {#if index > 0 && action.group !== entries[index - 1]?.group}
      <Menu.Separator />
    {/if}
    {@render renderedItem(action)}
  {/each}
{/snippet}

<Menu.Root bind:open>
  <Menu.Trigger>
    {#snippet child({ props })}
      {#if contextMenu}
        <Button
          {...props}
          type="button"
          aria-label={ariaLabel}
          class="pointer-events-none fixed size-px opacity-0"
          style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
        ></Button>
      {:else}
        {@render trigger?.({ props, open })}
      {/if}
    {/snippet}
  </Menu.Trigger>
  <Menu.Content
    {align}
    {side}
    sideOffset={contextMenu ? 0 : 4}
    collisionPadding={8}
    aria-label={ariaLabel}
    class={className}
  >
    {@render actionItems(resolvedActions)}
  </Menu.Content>
</Menu.Root>

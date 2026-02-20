<script lang="ts">
  import Header from './Header.svelte';
  import { Button } from './button';
  import { ScrollArea } from './scroll-area';
  import CollapsiblePanel from './CollapsiblePanel.svelte';
  import type { Component, Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    title?: string;
    icon?: any; // FontAwesome icon object
    showAction?: boolean;
    actionIcon?: any; // FontAwesome icon object
    actionLabel?: string;
    actionDisabled?: boolean;
    loading?: boolean;
    loadingIcon?: any; // FontAwesome icon object
    className?: string;
    contentClass?: string;
    headerSize?: 1 | 2 | 3 | 4 | 5 | 6;
    collapsible?: boolean;
    storageKey?: string;
    headerActions?: Snippet;
    defaultCollapsed?: boolean;
    onAction?: () => void;
    children?: Snippet;
  }

  let {
    title = '',
    icon = null,
    showAction = false,
    actionIcon = null,
    actionLabel = '',
    actionDisabled = false,
    loading = false,
    loadingIcon = faSpinner,
    className = '',
    contentClass = '',
    headerSize = 3,
    collapsible = false,
    storageKey = '',
    headerActions,
    defaultCollapsed = false,
    onAction,
    children,
  }: Props = $props();

  function handleAction(e: MouseEvent) {
    e.stopPropagation();
    onAction?.();
  }
</script>

{#if collapsible && title}
  <CollapsiblePanel {title} {icon} {storageKey} class={className} {defaultCollapsed}>
    {#snippet headerActions()}
      {#if showAction}
        <div class="flex items-center justify-end -my-2">
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={handleAction}
            disabled={actionDisabled || loading}
            title={actionLabel}
          >
            {#if loading && loadingIcon}
              <Fa icon={loadingIcon} size="sm" class="animate-spin" />
            {:else if actionIcon}
              <Fa icon={actionIcon} size="sm" />
            {/if}
          </Button>
        </div>
      {/if}
    {/snippet}

    <div class="relative flex-1 min-h-0 h-full">
      <ScrollArea class="h-full">
        <div class="px-4 py-2 {contentClass}">
          {@render children?.()}
        </div>
        <!-- Gradient fade-outs -->
        <div class="fade-edge-t-sidebar" aria-hidden="true"></div>
        <div class="fade-edge-b-sidebar" aria-hidden="true"></div>
      </ScrollArea>
    </div>
  </CollapsiblePanel>
{:else}
  <div class="flex flex-col {className}">
    {#if title || showAction}
      <div class="px-4 pt-5 pb-2 flex-none relative z-10">
        <div class="flex items-center justify-between">
          {#if title}
            <h3 class="m-0 text-sm font-medium">{title}</h3>
          {:else}
            <div></div>
          {/if}

          {#if showAction}
            <Button
              variant="ghost-light"
              size="icon-sm"
              class="-my-2"
              onclick={handleAction}
              disabled={actionDisabled || loading}
              title={actionLabel}
            >
              {#if loading && loadingIcon}
                <Fa icon={loadingIcon} size="sm" class="animate-spin" />
              {:else if actionIcon}
                <Fa icon={actionIcon} size="sm" />
              {/if}
            </Button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="relative flex-1 min-h-0 -mt-2 z-0">
      <ScrollArea class="h-full">
        <div class="px-4 pb-5 {!title && !showAction ? 'pt-5' : ''} {contentClass}">
          {@render children?.()}
        </div>
        <!-- Gradient fade-outs -->
        <div class="fade-edge-t-sidebar" aria-hidden="true"></div>
        <div class="fade-edge-b-sidebar" aria-hidden="true"></div>
      </ScrollArea>
    </div>
  </div>
{/if}

<script lang="ts">
  import type { ComponentType } from 'svelte';
  import Button from './button/button.svelte';

  interface Props {
    icon?: ComponentType;
    iconSize?: number;
    title?: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    class?: string;
  }

  let {
    icon: Icon,
    iconSize = 48,
    title = 'No items found',
    description = '',
    actionLabel = '',
    onAction,
    class: className = '',
  }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-4 text-center {className}">
  {#if Icon}
    <Icon size={iconSize} class="text-subtle mb-4" />
  {/if}

  {#if title}
    <h3 class="text-lg font-medium mb-1">{title}</h3>
  {/if}

  {#if description}
    <p class="text-sm text-subtle mb-4 max-w-md">
      {description}
    </p>
  {/if}

  {#if actionLabel && onAction}
    <Button onclick={onAction}>
      {actionLabel}
    </Button>
  {/if}
</div>

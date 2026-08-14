<script lang="ts">
  import type { Snippet } from 'svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { formatShortcut } from '$lib/utils/shortcuts';

  interface Props {
    label: string;
    shortcut: string | string[];
    children?: Snippet;
  }

  let { label, shortcut, children }: Props = $props();
  const shortcutLabel = $derived(formatShortcut(shortcut));
</script>

<Tooltip
  side="bottom"
  sideOffset={4}
  delayDuration={300}
  class="shrink-0"
  contentClass="flex items-center gap-3"
>
  {#snippet trigger()}
    {@render children?.()}
  {/snippet}

  {#snippet content()}
    <span data-tooltip-label>{label}</span>
    <kbd class="text-muted-foreground" data-tooltip-shortcut>{shortcutLabel}</kbd>
  {/snippet}
</Tooltip>

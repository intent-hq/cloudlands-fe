<script lang="ts">
  /**
   * @deprecated Use `$lib/components/ui/sheet`.
   * Removal gate: remove the legacy layout export after static and dynamic callers reach zero.
   */
  import { m } from '$shared/paraglide/messages.js';
  import type { Snippet } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';

  interface Props {
    isOpen?: boolean;
    title?: string;
    position?: 'left' | 'right';
    onclose?: () => void;
    icon?: Snippet;
    headerExtra?: Snippet;
    actions?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    isOpen = $bindable(false),
    title = '',
    position = 'right',
    onclose,
    icon,
    headerExtra,
    actions,
    children,
    footer,
  }: Props = $props();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onclose?.();
  }
</script>

<Sheet.Root bind:open={isOpen} onOpenChange={handleOpenChange}>
  <Sheet.Content
    side={position}
    showCloseButton={false}
    class="w-[600px] max-w-[calc(100vw-1rem)] gap-0 p-0 sm:max-w-[600px]"
  >
    <Sheet.Header
      class="flex-row items-center justify-between gap-2 border-b border-border px-6 py-2"
    >
      <div class="flex items-center flex-1 gap-2">
        {@render icon?.()}
        <Sheet.Title class="text-sm font-medium">{title}</Sheet.Title>
        <Sheet.Description class="sr-only">{title}</Sheet.Description>
        {@render headerExtra?.()}
      </div>

      <div class="flex gap-4 items-center">
        {@render actions?.()}
        <Sheet.Close
          aria-label={m.layout_drawer_close_ariaLabel()}
          class="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </Sheet.Close>
      </div>
    </Sheet.Header>

    <div class="flex-1 overflow-hidden relative">
      {@render children?.()}
      <div class="fade-edge-t-subtle" aria-hidden="true"></div>
      <div class="fade-edge-b-subtle" aria-hidden="true"></div>
    </div>

    {#if footer}
      <div class="border-t border-border px-6 py-4">
        {@render footer?.()}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

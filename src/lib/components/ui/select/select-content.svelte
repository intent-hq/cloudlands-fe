<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';

  let {
    wrapperId,
    class: className = '',
    wrapperClass = '',
    dropUp = false,
    portal = false,
    children,
  }: {
    wrapperId?: string;
    class?: string;
    wrapperClass?: string;
    dropUp?: boolean;
    portal?: boolean;
    children?: Snippet;
  } = $props();

  const usePortal = $derived(dropUp || portal);
</script>

<SelectPrimitive.Portal disabled={!usePortal}>
  <SelectPrimitive.Content
    data-slot="select-content"
    side={dropUp ? 'top' : 'bottom'}
    sideOffset={4}
    class="z-(--layer-popover) w-(--bits-select-anchor-width) max-h-60 overflow-hidden rounded-(--radius-medium) border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay) {className}"
    style="max-width: calc(100vw - var(--space-4));"
  >
    {#snippet child({ props, wrapperProps })}
      <div {...wrapperProps} {...wrapperId ? { id: wrapperId } : {}}>
        <div {...props}>
          <SelectPrimitive.Viewport class="min-h-0 flex-1 overflow-y-auto py-1 {wrapperClass}">
            {@render children?.()}
          </SelectPrimitive.Viewport>
        </div>
      </div>
    {/snippet}
  </SelectPrimitive.Content>
</SelectPrimitive.Portal>

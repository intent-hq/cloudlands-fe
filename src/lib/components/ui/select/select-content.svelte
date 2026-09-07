<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  import { menuOverlay } from '../menu/menu-recipes';
  import { cn } from '$lib/utils';
  import {
    clampSurface,
    setSurface,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';

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
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const select = getContext<{ triggerId: string; listboxId: string }>('canonical-select');

  function withoutListboxSemantics(props: Record<string, unknown>) {
    const { role: _role, tabindex: _tabindex, ...contentProps } = props;
    return contentProps;
  }
</script>

<SelectPrimitive.Portal disabled={!usePortal}>
  <SelectPrimitive.Content
    data-slot="select-content"
    data-surface-level={surface}
    side={dropUp ? 'top' : 'bottom'}
    sideOffset={4}
    class={cn(
      menuOverlay(),
      surfaceClasses(surface),
      'w-(--bits-select-anchor-width) max-h-60 rounded-(--radius-medium)',
      className,
    )}
    style="max-width: calc(100vw - var(--space-4));"
  >
    {#snippet child({ props, wrapperProps })}
      {@const contentProps = withoutListboxSemantics(props)}
      <div {...wrapperProps} {...wrapperId ? { id: wrapperId } : {}}>
        <div {...contentProps}>
          <SelectPrimitive.Viewport
            class="relative min-h-0 flex-1 overflow-y-auto py-1 {wrapperClass}"
          >
            {#snippet child({ props: viewportProps })}
              <div
                {...viewportProps}
                id={select.listboxId}
                role="listbox"
                aria-labelledby={select.triggerId}
                tabindex="0"
              >
                <ListHighlight />
                {@render children?.()}
              </div>
            {/snippet}
          </SelectPrimitive.Viewport>
        </div>
      </div>
    {/snippet}
  </SelectPrimitive.Content>
</SelectPrimitive.Portal>

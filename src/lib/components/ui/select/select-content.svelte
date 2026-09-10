<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  import { menuOverlay } from '../menu/menu-recipes';
  import { cn } from '$lib/utils';
  import {
    clampSurface,
    setSurface,
    SURFACE_BG,
    useSurface,
  } from '$lib/components/ui/surface-context';
  import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';

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
  const select = getContext<{
    triggerId: string;
    listboxId: string;
    staticPosition: boolean;
  }>('canonical-select');

  function withoutListboxSemantics(props: Record<string, unknown>) {
    const { role: _role, tabindex: _tabindex, ...contentProps } = props;
    return contentProps;
  }
</script>

{#snippet contentBody()}
  <SelectPrimitive.Viewport
    class="{OPTION_LIST_CONTAINER_CLASS} relative min-h-0 flex-1 overflow-y-auto {wrapperClass}"
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
{/snippet}

{#snippet staticContentChild({ props }: { props: Record<string, unknown> })}
  {@const contentProps = withoutListboxSemantics(props)}
  <div {...contentProps} {...wrapperId ? { id: wrapperId } : {}}>
    {@render contentBody()}
  </div>
{/snippet}

{#snippet contentChild({
  props,
  wrapperProps,
}: {
  props: Record<string, unknown>;
  wrapperProps: Record<string, unknown>;
})}
  {@const contentProps = withoutListboxSemantics(props)}
  <div {...wrapperProps} {...wrapperId ? { id: wrapperId } : {}}>
    <div {...contentProps}>{@render contentBody()}</div>
  </div>
{/snippet}

{#if select.staticPosition}
  <SelectPrimitive.ContentStatic
    data-slot="select-content"
    data-static-position
    data-surface-level={surface}
    class={cn(
      menuOverlay(),
      SURFACE_BG[surface],
      'w-full max-h-60 rounded-(--radius-medium)',
      className,
    )}
    style="max-width: calc(100vw - var(--space-4));"
    child={staticContentChild}
  />
{:else}
  <SelectPrimitive.Portal disabled={!usePortal}>
    <SelectPrimitive.Content
      data-slot="select-content"
      data-surface-level={surface}
      side={dropUp ? 'top' : 'bottom'}
      sideOffset={4}
      class={cn(
        menuOverlay(),
        SURFACE_BG[surface],
        'w-(--bits-select-anchor-width) max-h-60 rounded-(--radius-medium)',
        className,
      )}
      style="max-width: calc(100vw - var(--space-4));"
      child={contentChild}
    />
  </SelectPrimitive.Portal>
{/if}

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { onMount } from 'svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  type NavigationHelpComponentId = 'breadcrumb' | 'kbd' | 'tooltip' | 'sidebar' | 'scroll-area';
  type NavigationHelpCatalogRendererProps = Omit<CatalogRendererProps, 'componentId'> & {
    componentId: NavigationHelpComponentId;
  };

  let { componentId, fixture }: NavigationHelpCatalogRendererProps = $props();
  let tooltipOpen = $state(false);

  onMount(() => {
    if (componentId !== 'tooltip') return;
    const frame = requestAnimationFrame(() => (tooltipOpen = true));
    return () => cancelAnimationFrame(frame);
  });

  function keepTooltipPreviewOpen(open: boolean) {
    if (open || componentId !== 'tooltip') return;
    requestAnimationFrame(() => (tooltipOpen = true));
  }
</script>

<div
  class="grid w-full min-w-0 grid-cols-1 gap-4 overflow-hidden"
  data-catalog-renderer-fixture={fixture.id}
>
  {#if componentId === 'breadcrumb'}
    <div
      class="w-full min-w-0 overflow-hidden"
      data-catalog-rendered-state="navigation current-page ellipsis long-content keyboard-focus overlay-hover compact zoom-200 no-overflow light dark reduced-motion"
    >
      <Breadcrumb.Root aria-label="Catalog path">
        <Breadcrumb.List>
          <Breadcrumb.Item
            ><Breadcrumb.Link href="/sandbox">Catalog</Breadcrumb.Link></Breadcrumb.Item
          >
          <Breadcrumb.Separator />
          <Breadcrumb.Item><Breadcrumb.Ellipsis /></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item>
            <Breadcrumb.Link href="/sandbox/navigation">Navigation primitives</Breadcrumb.Link>
          </Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item>
            <Breadcrumb.Page
              >A deliberately long current page label for compact layouts</Breadcrumb.Page
            >
          </Breadcrumb.Item>
        </Breadcrumb.List>
      </Breadcrumb.Root>
    </div>
  {:else if componentId === 'kbd'}
    <div
      class="flex flex-wrap items-center gap-3"
      data-catalog-rendered-state="single-key modifier key-sequence long-key light dark zoom-200"
    >
      <ShortcutChip>Esc</ShortcutChip>
      <div class="flex items-center gap-1" aria-label="Command K shortcut">
        <ShortcutChip>⌘</ShortcutChip>
        <span aria-hidden="true">+</span>
        <ShortcutChip>K</ShortcutChip>
      </div>
      <ShortcutChip>Enter</ShortcutChip>
      <ShortcutChip class="min-w-16">Page Down</ShortcutChip>
    </div>
  {:else if componentId === 'tooltip'}
    <div class="pb-10" data-catalog-rendered-state="open portal arrow reduced-motion">
      <Tooltip.Provider delayDuration={0}>
        <Tooltip.Root
          bind:open={tooltipOpen}
          delayDuration={0}
          onOpenChange={keepTooltipPreviewOpen}
        >
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="sm">Keyboard help</Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="bottom">Press Command K to open navigation.</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
    <div data-catalog-rendered-state="closed hover-delay keyboard-focus escape-dismiss">
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root delayDuration={300}>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" size="sm">Delayed help</Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Focus or pause to show help.</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
  {:else if componentId === 'sidebar'}
    <div
      data-catalog-rendered-state="default floating inset nested actions-and-badges collapsed peek-hover resizing reduced-motion"
    >
      <Sidebar.Harness />
    </div>
  {:else if componentId === 'scroll-area'}
    <div
      class="grid gap-3"
      data-catalog-rendered-state="vertical horizontal both keyboard-focus long-content no-overflow reduced-motion"
    >
      <ScrollArea orientation="both" class="h-36 max-w-full rounded-md border border-border">
        <div class="w-max space-y-2 p-3">
          {#each Array.from({ length: 18 }) as _, index (index)}
            <p>
              Navigation documentation row {index + 1} with deliberately long horizontal content
            </p>
          {/each}
        </div>
      </ScrollArea>
      <ScrollArea orientation="vertical" class="h-16 max-w-full">
        <p>Short content does not overflow.</p>
      </ScrollArea>
    </div>
  {/if}
</div>

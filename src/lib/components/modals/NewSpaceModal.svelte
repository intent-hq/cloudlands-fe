<script lang="ts">
  /**
   * NewSpaceModal - Modal wrapper around CompactWorkspaceInitializer
   * Can be opened from anywhere in the app (Cmd+N, sidebar, overlay, etc.)
   * without navigating away from the current page.
   */
  import * as Dialog from '$lib/components/ui/dialog';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { acquireMarkerAttribute } from '$lib/utils/marker-attribute-lease';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onClose?: () => void;
  }

  let { open = $bindable(false), onClose }: Props = $props();

  let isExpanded = $state(true);
  let initializerRef: CompactWorkspaceInitializer | null = $state(null);
  let contentRef: HTMLElement | null = $state(null);

  function close() {
    open = false;
    onClose?.();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) close();
  }

  // Escape layer: works even when inputs are focused, and only the topmost
  // overlay (e.g. a lightbox opened above this modal) handles Escape
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(close);
  });

  // Focus the form when the modal opens
  $effect(() => {
    if (!open) return;
    isExpanded = true;
    initializerRef?.applyPrefill();
    const focusTimer = setTimeout(() => initializerRef?.focusAndSelectAll(), 150);
    return () => clearTimeout(focusTimer);
  });

  // Mark <body> while the dialog content is mounted (including its outro) so the
  // layering rules below can key off an attribute. A `body:has(...)` anchor would
  // make every DOM/style mutation in the page a candidate `:has()` invalidation.
  // The marker is leased per instance so overlapping modals keep it until the
  // last one detaches.
  $effect(() => {
    if (!contentRef) return;
    return acquireMarkerAttribute(contentRef.ownerDocument.body, 'data-new-space-modal-open');
  });
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content
    bind:ref={contentRef}
    data-new-space-modal
    data-model-picker-collision-boundary
    showCloseButton={true}
    closeLabel={m.ui_updateToast_close_ariaLabel()}
    escapeKeydownBehavior="ignore"
    class="flex max-w-4xl flex-col gap-0 overflow-hidden rounded-lg border border-border bg-popover p-0"
  >
    <div class="flex shrink-0 items-center border-b border-border px-6 py-4 pr-12">
      <Dialog.Title class="type-title text-foreground">{m.modals_newSpace_title()}</Dialog.Title>
      <Dialog.Description class="sr-only">
        {m.workspace_repoSelector_whichRepo_description()}
      </Dialog.Description>
    </div>

    <div class="min-h-0 overflow-y-auto overscroll-contain bg-background px-6 py-6 sm:px-8">
      <CompactWorkspaceInitializer bind:this={initializerRef} bind:isExpanded oncreate={close} />
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(body[data-new-space-modal-open] [data-slot='select-content']),
  :global(body[data-new-space-modal-open] [data-slot='menu-content']) {
    z-index: var(--layer-tooltip);
  }

  :global(body[data-new-space-modal-open] [data-slot='dialog-overlay']) {
    z-index: calc(var(--layer-tooltip) - 1);
  }

  :global(body[data-new-space-modal-open] [data-slot='dialog-content']) {
    z-index: var(--layer-tooltip);
  }
</style>

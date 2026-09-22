<script lang="ts">
  /**
   * NewSpaceModal - Modal wrapper around CompactWorkspaceInitializer
   * Can be opened from anywhere in the app (Cmd+N, sidebar, overlay, etc.)
   * without navigating away from the current page.
   */
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import type { Snippet } from 'svelte';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { acquireMarkerAttribute } from '$lib/utils/marker-attribute-lease';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    initializer?: Snippet;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    initializer,
    onClose,
  }: Props = $props();

  let isExpanded = $state(true);
  let initializerRef: CompactWorkspaceInitializer | null = $state(null);
  let contentRef: HTMLElement | null = $state(null);

  function close() {
    open = false;
    onClose?.();
  }

  // Escape layer: works even when inputs are focused, and only the topmost
  // overlay (e.g. a lightbox opened above this modal) handles Escape
  $effect(() => {
    if (!open || staticPosition) return;
    return pushEscapeLayer(close);
  });

  // Prepare the form; Dialog.Content owns initial focus on the primary action.
  $effect(() => {
    if (!open || staticPosition) return;
    isExpanded = true;
    initializerRef?.applyPrefill();
  });

  // Mark <body> while the dialog content is mounted (including its outro) so the
  // layering rules below can key off an attribute. A `body:has(...)` anchor would
  // make every DOM/style mutation in the page a candidate `:has()` invalidation.
  // The marker is leased per instance so overlapping modals keep it until the
  // last one detaches.
  $effect(() => {
    if (!contentRef || staticPosition) return;
    const releaseBody = acquireMarkerAttribute(
      contentRef.ownerDocument.body,
      'data-new-space-modal-open',
    );
    const releaseMarker = acquireMarkerAttribute(contentRef, 'data-new-space-modal');
    const releaseBoundary = acquireMarkerAttribute(
      contentRef,
      'data-model-picker-collision-boundary',
    );
    return () => {
      releaseBody();
      releaseMarker();
      releaseBoundary();
    };
  });
</script>

<ContentDialog
  bind:open
  static={staticPosition}
  bind:contentRef
  size="editor"
  title={m.modals_newSpace_title()}
  closeLabel={m.ui_updateToast_close_ariaLabel()}
  escapeKeydownBehavior="ignore"
  onClose={close}
>
  <div class="min-w-0">
    {#if initializer}
      {@render initializer()}
    {:else}
      <CompactWorkspaceInitializer bind:this={initializerRef} bind:isExpanded autoFocus={false} oncreate={close} />
    {/if}
  </div>
</ContentDialog>

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

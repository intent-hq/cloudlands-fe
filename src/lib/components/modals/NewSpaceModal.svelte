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
    if (!contentRef) return;
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
  allowOverflow
  title={m.modals_newSpace_title()}
  closeLabel={m.ui_updateToast_close_ariaLabel()}
  escapeKeydownBehavior="ignore"
  onClose={close}
>
  {#if isExpanded}
    <div class="workspace-sidebar-surface" aria-hidden="true"></div>
  {/if}
  <div class="workspace-form min-w-0">
    {#if initializer}
      {@render initializer()}
    {:else}
      <CompactWorkspaceInitializer
        bind:this={initializerRef}
        bind:isExpanded
        autoFocus={false}
        defaultToSidebarRepository
        oncreate={close}
      />
    {/if}
  </div>
</ContentDialog>

<style>
  :global([data-new-space-modal] > .dialog-layout > [data-slot='dialog-header']) {
    padding-top: 1.25rem;
  }

  :global(
    [data-new-space-modal]
      > .dialog-layout
      > [data-slot='dialog-header']
      > [data-slot='dialog-title']
  ) {
    font-size: var(--text-sm);
    line-height: 1.25rem;
    font-weight: var(--text-body-weight);
  }

  :global([data-new-space-modal] > .dialog-layout > [data-slot='dialog-body']) {
    padding-top: 0.5rem;
    padding-bottom: 1rem;
  }

  :global([data-new-space-modal] > .dialog-close-button) {
    top: calc(anchor(--dialog-title top, 1.25rem) + 1.25rem / 2);
  }

  .workspace-form :global(.prompt-pane) {
    padding-block: 0 0.5rem;
  }

  .workspace-form :global(.settings-pane) {
    padding: 0 0 0.5rem 2rem;
  }

  .workspace-sidebar-surface {
    display: none;
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: calc(21rem + 1.5rem);
    pointer-events: none;
    z-index: -1;
    background: var(--color-sidebar);
    border-start-end-radius: var(--radius-medium);
    border-end-end-radius: var(--radius-medium);
  }

  :global(.dark) .workspace-sidebar-surface {
    background: var(--color-background);
  }

  @container (min-width: 51rem) {
    .workspace-sidebar-surface {
      display: block;
    }
  }

  @container (max-width: 47.99rem) {
    .workspace-form :global(.prompt-pane) {
      padding-block: 0;
    }

    .workspace-form :global(.initializer-layout.expanded) {
      row-gap: 1rem;
    }

    .workspace-form :global(.settings-pane) {
      margin-inline: -1.5rem;
      margin-bottom: -1rem;
      padding: 1rem 1.5rem 1.5rem 2rem;
      border-end-start-radius: var(--radius-medium);
      border-end-end-radius: var(--radius-medium);
    }
  }

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

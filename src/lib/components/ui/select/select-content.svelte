<script lang="ts">
  import { getContext, tick, type Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import ListHighlight from '../menu/menu-list-highlight.svelte';
  import { menuOverlay } from '../menu/menu-recipes';
  import { cn } from '$lib/utils';
  import { clampSurface, setSurface, useSurface } from '$lib/components/ui/surface-context';
  import { OPTION_LIST_CONTAINER_CLASS } from '$lib/styles/option-list-row';
  import { OVERLAY_VIEWPORT_GUTTER } from '$lib/components/ui/overlay-positioning';
  import {
    createOwnedPopupRegistration,
    getOwnedPopupContext,
  } from '$lib/components/ui/owned-popup-context';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';

  const popupOwner = getOwnedPopupContext();
  const registerOwnedPopup = createOwnedPopupRegistration();

  let {
    wrapperId,
    class: className = '',
    wrapperClass = '',
    dropUp = false,
    portal,
    children,
  }: {
    wrapperId?: string;
    class?: string;
    wrapperClass?: string;
    dropUp?: boolean;
    /** Body portal when true; inline when false; unset (and not dropUp) portals into an enclosing dialog, else inline. */
    portal?: boolean;
    children?: Snippet;
  } = $props();

  type StaticContentChildProps = { props: Record<string, unknown> };
  type ContentChildProps = StaticContentChildProps & {
    wrapperProps: Record<string, unknown>;
  };

  const usePortal = $derived(dropUp || portal === true);
  // Inside a dialog, an inline list is clipped by the dialog's scroll body and
  // a body portal sits under the modal layer and outside its focus scope, so
  // portal into the dialog itself (see useDialogPortalTarget).
  const dialogPortalTarget = useDialogPortalTarget();
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  const select = getContext<{
    triggerId: string;
    listboxId: string;
    staticPosition: boolean;
    open: boolean;
  }>('canonical-select');

  async function restoreTriggerFocusOnEscape() {
    // bits-ui leaves focus in place; searchable consumers can move it into content.
    const trigger = document.getElementById(select.triggerId);
    await tick();
    if (!select.open && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

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
        tabindex="-1"
      >
        <ListHighlight />
        {@render children?.()}
      </div>
    {/snippet}
  </SelectPrimitive.Viewport>
{/snippet}

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet staticContentChild({ props }: StaticContentChildProps)}
  {@const contentProps = withoutListboxSemantics(props)}
  <div use:registerOwnedPopup {...contentProps} {...wrapperId ? { id: wrapperId } : {}}>
    {@render contentBody()}
  </div>
{/snippet}

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet contentChild({ props, wrapperProps }: ContentChildProps)}
  {@const contentProps = withoutListboxSemantics(props)}
  <div {...wrapperProps} {...wrapperId ? { id: wrapperId } : {}}>
    <div use:registerOwnedPopup {...contentProps}>{@render contentBody()}</div>
  </div>
{/snippet}

{#if select.staticPosition}
  <SelectPrimitive.ContentStatic
    preventScroll={false}
    onEscapeKeydown={restoreTriggerFocusOnEscape}
    data-slot="select-content"
    data-static-position
    data-surface-level={surface}
    class={cn(menuOverlay(), 'w-full max-h-60 rounded-(--radius-medium)', className)}
    style="max-width: calc(100vw - var(--space-4));"
    child={staticContentChild}
  />
{:else}
  {@const dialogTarget = portal === undefined && !dropUp ? dialogPortalTarget() : undefined}
  <SelectPrimitive.Portal
    disabled={!usePortal && !dialogTarget}
    to={dialogTarget ?? popupOwner?.target()}
  >
    <SelectPrimitive.Content
      strategy={dialogTarget ? 'absolute' : 'fixed'}
      hideWhenDetached={dialogTarget !== undefined}
      onEscapeKeydown={restoreTriggerFocusOnEscape}
      data-slot="select-content"
      data-surface-level={surface}
      side={dropUp ? 'top' : 'bottom'}
      sideOffset={4}
      collisionPadding={OVERLAY_VIEWPORT_GUTTER}
      class={cn(
        menuOverlay(),
        'w-(--bits-select-anchor-width) max-h-60 rounded-(--radius-medium)',
        className,
      )}
      style="max-width: calc(100vw - var(--space-4));"
      child={contentChild}
    />
  </SelectPrimitive.Portal>
{/if}

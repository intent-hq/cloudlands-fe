<script lang="ts">
  import { onMount } from 'svelte';
  import { Toast, toast } from '$lib/components/ui/toast';

  let { register }: { register: (element: HTMLElement) => () => void } = $props();
  const uid = $props.id();
  const regionId = `dock-conversation-notifications-${uid}`;
  let host: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  const renderedIds = new Set<string | number>();

  function rememberRendered() {
    if (!host) return;
    const positions = new Set(
      Array.from(host.querySelectorAll<HTMLElement>('[data-sonner-toaster]'))
        .filter((toaster) => toaster.querySelector('[data-sonner-toast]'))
        .map((toaster) => `${toaster.dataset.yPosition}-${toaster.dataset.xPosition}`),
    );
    // The canonical id-less host renders only unaddressed notifications. Keep
    // their public IDs, never dismiss another named host's notification queue.
    for (const notification of toast.getActiveToasts()) {
      if (!notification.toasterId && positions.has(notification.position ?? 'bottom-left'))
        renderedIds.add(notification.id);
    }
  }

  function dismissRendered() {
    rememberRendered();
    for (const notification of toast.getActiveToasts()) {
      if (!notification.toasterId && renderedIds.has(notification.id))
        toast.dismiss(notification.id);
    }
    renderedIds.clear();
  }

  onMount(() => {
    const registrations = new Map<HTMLElement, () => void>();
    function update() {
      rememberRendered();
      const content = new Set(
        host.querySelectorAll<HTMLElement>(
          '[data-sonner-toast]:not([data-removed="true"]):not([data-visible="false"]):not([inert]), .toast-clear-all',
        ),
      );
      for (const [element, remove] of registrations) {
        if (content.has(element)) continue;
        remove();
        registrations.delete(element);
      }
      for (const element of content) {
        if (!registrations.has(element)) registrations.set(element, register(element));
      }
    }
    const observer = new MutationObserver(update);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-removed', 'data-visible', 'inert'],
    });
    update();
    return () => {
      observer.disconnect();
      for (const remove of registrations.values()) remove();
      dismissRendered();
    };
  });
</script>

<div
  bind:this={host}
  bind:clientWidth={width}
  bind:clientHeight={height}
  class="conversation-notifications"
  data-dock-conversation-notifications
  style:--dock-toast-width={`${Math.max(0, width - 32)}px`}
  style:--dock-toast-height={`${Math.max(0, height - 80)}px`}
>
  <Toast {regionId} onClearAll={dismissRendered} />
</div>

<style>
  .conversation-notifications {
    position: absolute;
    inset: 0;
    contain: layout;
    pointer-events: none;
    z-index: var(--layer-popover, 50);
  }
  .conversation-notifications :global([data-sonner-toaster]) {
    position: absolute !important;
    --app-toast-width: min(22rem, var(--dock-toast-width)) !important;
    --toast-max-height: var(--dock-toast-height) !important;
  }
  .conversation-notifications :global(.toast-clear-all) {
    position: absolute;
  }
</style>

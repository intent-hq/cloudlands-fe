<script lang="ts">
  import { onMount } from 'svelte';
  import { Toaster as Sonner, toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import { m } from '$shared/paraglide/messages.js';

  const isDarkTheme = selectIsDarkTheme();
  let visibleToastCount = $state(0);
  let showClearAll = $derived(visibleToastCount >= 2);
  let offset = $derived({ bottom: showClearAll ? 68 : 32, left: 32 });
  let mobileOffset = $derived({ bottom: showClearAll ? 52 : 16, left: 16 });

  onMount(() => {
    const updateVisibleToastCount = () => {
      visibleToastCount = document.querySelectorAll(
        '#app-toast-region [data-sonner-toast][data-visible="true"]:not([data-removed="true"])',
      ).length;
    };
    const observer = new MutationObserver(updateVisibleToastCount);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-visible', 'data-removed'],
    });
    updateVisibleToastCount();
    return () => observer.disconnect();
  });

  function clearVisibleToasts() {
    toast.dismiss();
    visibleToastCount = 0;
  }
</script>

<Sonner
  id="app-toast-region"
  theme={$isDarkTheme ? 'dark' : 'light'}
  class="toaster group"
  style="--app-toast-width: min(26rem, calc(100vw - clamp(2rem, 8vw, 4rem)))"
  {offset}
  {mobileOffset}
  containerAriaLabel={m.ui_toast_notifications_ariaLabel()}
  closeButtonAriaLabel={m.ui_toast_close_ariaLabel()}
  toastOptions={{
    classes: {
      toast:
        'group toast w-full min-w-0 max-w-full group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-(--elevation-overlay)',
      description: 'group-[.toast]:text-subtle text-sm',
      actionButton:
        'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted group-[.toast]:px-4 group-[.toast]:py-2 group-[.toast]:text-sm group-[.toast]:font-semibold group-[.toast]:transition-colors',
      cancelButton:
        'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted group-[.toast]:px-4 group-[.toast]:py-2 group-[.toast]:text-sm group-[.toast]:font-semibold',
      action: 'text-sm font-semibold',
    },
  }}
  position="bottom-left"
  closeButton
  duration={10000}
  gap={8}
/>

{#if showClearAll}
  <Button
    variant="outline"
    size="sm"
    class="toast-clear-all"
    onclick={clearVisibleToasts}
    aria-controls="app-toast-region"
    aria-label={m.ui_toast_clearAll_ariaLabel({ count: visibleToastCount })}
  >
    {m.ui_toast_clearAll_label()}
  </Button>
{/if}

<style>
  :global([data-sonner-toaster]) {
    --width: var(--app-toast-width) !important;
    width: var(--app-toast-width) !important;
  }

  :global([data-sonner-toast]) {
    background: hsl(var(--card)) !important;
    color: hsl(var(--foreground)) !important;
    /* Width/style stay !important, but color must NOT be — per-toast Tailwind
       classes (e.g. !border-destructive/50 on custom toasts) override it.
       This also relies on these :global styles staying UNLAYERED: moving them
       into a cascade layer would change the fallback chain for default toasts. */
    border-width: 1px !important;
    border-style: solid !important;
    border-color: hsl(var(--border));
    border-radius: 0 !important;
    backdrop-filter: blur(8px);
    width: var(--app-toast-width) !important;
    min-width: 0;
    max-width: 100%;
    padding: 1rem 1.25rem;
    align-items: flex-start !important;
    box-shadow: var(--elevation-overlay);
  }

  :global([data-sonner-toast] [data-icon]) {
    margin-top: 2px;
  }

  :global([data-sonner-toast] [data-description]) {
    color: hsl(var(--muted-foreground)) !important;
    font-size: 0.875rem;
    margin-top: 0.25rem;
  }

  :global([data-sonner-toast] [data-content]),
  :global([data-sonner-toast] [data-title]),
  :global([data-sonner-toast] [data-description]) {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* Action buttons using CSS variables */
  :global([data-sonner-toast] button[data-button]) {
    font-size: 0.875rem !important;
    font-weight: 600 !important;
    padding: 0.5rem 1rem !important;
    border-radius: 0 !important;
    transition: all 0.15s ease !important;
    border: 1px solid hsl(var(--border)) !important;
    background: transparent !important;
    color: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast] button[data-button]:hover) {
    background: hsl(var(--muted)) !important;
    border-color: hsl(var(--border)) !important;
  }

  :global([data-sonner-toast] [data-icon]) {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* Close button styling */
  :global([data-sonner-toast] [data-close-button]) {
    color: hsl(var(--muted-foreground)) !important;
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--card)) !important;
  }

  :global([data-sonner-toaster][dir='ltr']) {
    --toast-close-button-start: unset;
    --toast-close-button-end: 0;
    --toast-close-button-transform: translate(35%, -35%);
  }

  :global(.toast-clear-all) {
    position: fixed;
    left: 2rem;
    bottom: 2rem;
    z-index: 1000000000;
    min-height: 1.75rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1rem;
    box-shadow: var(--elevation-raised);
    cursor: pointer;
  }

  :global(.toast-clear-all:hover) {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  :global(.toast-clear-all:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  @media (max-width: 600px) {
    :global(.toast-clear-all) {
      left: 1rem;
      bottom: 1rem;
    }
  }

  :global(.sonner-loading-bar) {
    background-color: hsl(var(--muted-foreground) / 0.3);
  }

  /* Warning/undo toasts — inverted (foreground bg, background text) */
  :global([data-sonner-toast][data-type='warning']) {
    background: hsl(var(--foreground)) !important;
    color: hsl(var(--background)) !important;
    border-color: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast][data-type='warning'] [data-description]) {
    color: hsl(var(--background) / 0.7) !important;
  }

  :global([data-sonner-toast][data-type='warning'] [data-close-button]) {
    color: hsl(var(--background)) !important;
    border-color: hsl(var(--background) / 0.2) !important;
    background: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast][data-type='warning'] button[data-button]) {
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    border: none !important;
    font-weight: 700 !important;
  }

  :global([data-sonner-toast][data-type='warning'] button[data-button]:hover) {
    background: hsl(var(--background) / 0.85) !important;
    border: none !important;
  }
</style>

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

<!-- The wrapper div owns the `app-toast-region` DOM id: since svelte-sonner
     1.2.0 the `id` prop identifies the toaster for `toast(..., { toasterId })`
     targeting (an id-bearing toaster renders ONLY matching toasts) and is no
     longer applied to the <ol> element, so it must not be passed here. The
     MutationObserver selector and the Clear-all `aria-controls` anchor on this
     div instead.

     `expand` keeps stacked toasts at their own height with content visible —
     a UX decision kept through the 1.2.1 upgrade (which fixed heights ordering
     so --front-toast-height now tracks the front toast). -->
<div id="app-toast-region">
  <Sonner
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
    expand
  />
</div>

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
    /* background-COLOR, not the shorthand: the countdown bar (below) animates
       background-size on opted-in toasts, and an !important shorthand here
       would lock every background longhand (CSS animations cannot override
       !important declarations). */
    background-color: hsl(var(--card)) !important;
    color: hsl(var(--foreground)) !important;
    /* Width/style stay !important, but color must NOT be — per-toast Tailwind
       classes (e.g. !border-danger/50 on custom toasts) override it.
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

  /* Warning toasts — card surface with a warning accent (border + icon).
     Background, text, description, close button, and action buttons fall
     through to the base [data-sonner-toast] rules above, which are
     theme-aware and legible in both light and dark themes. */
  :global([data-sonner-toast][data-type='warning']) {
    --toast-warning-accent: var(--warning);
    border-color: hsl(var(--toast-warning-accent)) !important;
  }

  /* In light theme the raw --warning token (42 91% 54%) is only ~1.8:1
     against the white card surface — below the 3:1 non-text minimum. Use a
     darker shade of the same hue for the accent (42 91% 35% ≈ 3.8:1);
     dark theme keeps the token (~12:1 against the dark card). Toast-local
     on purpose: other --warning consumers are unaffected. */
  :global(
    [data-sonner-toaster][data-sonner-theme='light'] [data-sonner-toast][data-type='warning']
  ) {
    --toast-warning-accent: 42 91% 35%;
  }

  :global([data-sonner-toast][data-type='warning'] [data-icon]) {
    color: hsl(var(--toast-warning-accent));
  }

  /* Countdown progress bar — opt-in via withToastCountdown() (see
     toast-countdown.ts). A thin bar along the toast's bottom edge shrinks
     linearly over --toast-countdown-duration, which the helper derives from
     the same duration passed to the toast. Drawn as a bottom-anchored
     background gradient because sonner owns both pseudo-elements (::after is
     the hover gap-filler between stacked toasts, ::before the swipe
     hit-area). Excluded during swipe-out so sonner's swipe-out keyframes keep
     the element's animation slot. */
  :global([data-sonner-toaster] [data-sonner-toast].toast-countdown:not([data-swipe-out='true'])) {
    --toast-countdown-color: hsl(var(--muted-foreground) / 0.4);
    background-image: linear-gradient(var(--toast-countdown-color), var(--toast-countdown-color));
    background-repeat: no-repeat;
    background-position: left bottom;
    /* Pre-animation value; also the static reduced-motion rendering. */
    background-size: 100% 2px;
    animation: toast-countdown-shrink var(--toast-countdown-duration, 10000ms) linear forwards;
  }

  /* Undo/warning toasts tint the bar with the same accent as their border.
     The [data-sonner-toaster] prefix ties specificity (0,4,0) with the base
     rule above (whose :not() argument counts); later source order wins. */
  :global([data-sonner-toaster] [data-sonner-toast][data-type='warning'].toast-countdown) {
    --toast-countdown-color: hsl(var(--toast-warning-accent) / 0.6);
  }

  /* Sonner pauses its dismiss timer while the toaster is hovered (its
     expanded/interacting pause states are driven by the <ol>'s
     mouseenter/mousemove and pointer handlers; focus alone never pauses the
     timer, so no :focus-within here) — pause the bar in sync so it never
     empties while the toast lingers. Toasts whose countdown mirrors an
     independent deadline that keeps running during sonner's pause opt out
     via withToastCountdown's pauseOnHover: false (the
     .toast-countdown-no-hover-pause class). */
  :global(
    [data-sonner-toaster]:hover
      [data-sonner-toast].toast-countdown:not(.toast-countdown-no-hover-pause)
  ) {
    animation-play-state: paused;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(
      [data-sonner-toaster] [data-sonner-toast].toast-countdown:not([data-swipe-out='true'])
    ) {
      /* No moving bar — the static full-width bar from background-size stays. */
      animation: none;
    }
  }

  @keyframes -global-toast-countdown-shrink {
    from {
      background-size: 100% 2px;
    }
    to {
      background-size: 0% 2px;
    }
  }
</style>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { Toaster as Sonner, toast, type ToasterProps } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import ToastGlyph from './ToastGlyph.svelte';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import {
    clampSurface,
    setSurface,
    SURFACE_VALUE,
    surfaceClasses,
    useSurface,
  } from '$lib/components/ui/surface-context';

  interface Props {
    regionId?: string;
    toasterId?: string;
    position?: ToasterProps['position'];
    staticPosition?: boolean;
    staticToastCount?: number;
    onClearAll?: () => void;
    containerAriaLabel?: string;
  }

  let {
    regionId = 'app-toast-region',
    toasterId,
    position = 'bottom-left',
    staticPosition = false,
    staticToastCount,
    onClearAll,
    containerAriaLabel = m.ui_toast_notifications_ariaLabel(),
  }: Props = $props();

  const initialStaticPosition = untrack(() => staticPosition);
  const staticTheme = writable(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  const isDarkTheme = initialStaticPosition ? staticTheme : selectIsDarkTheme();
  const surface = clampSurface(useSurface() + 2);
  setSurface(surface);
  let visibleToastCount = $state(0);
  let toastCount = $derived(staticToastCount ?? visibleToastCount);
  let showClearAll = $derived(toastCount >= 2);
  let offset = $derived({ bottom: showClearAll ? 68 : 32, left: 32 });
  let mobileOffset = $derived({ bottom: showClearAll ? 52 : 16, left: 16 });
  let regionElement: HTMLDivElement;

  onMount(() => {
    const themeObserver = initialStaticPosition
      ? new MutationObserver(() =>
          staticTheme.set(document.documentElement.classList.contains('dark')),
        )
      : undefined;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    const updateVisibleToastCount = () => {
      const visibleToasts = Array.from(
        regionElement.querySelectorAll<HTMLElement>(
          '[data-sonner-toast][data-visible="true"]:not([data-removed="true"])',
        ),
      );
      visibleToastCount = visibleToasts.length;

      for (const toastElement of visibleToasts) {
        const closeButton = toastElement.querySelector<HTMLElement>(':scope > [data-close-button]');
        if (closeButton && toastElement.lastElementChild !== closeButton) {
          toastElement.append(closeButton);
        }

        const isFront = toastElement.dataset.front === 'true';
        const existingCount = toastElement.querySelector<HTMLElement>(
          ':scope > [data-toast-stack-count]',
        );
        if (!isFront || visibleToasts.length < 2) {
          existingCount?.remove();
          continue;
        }

        const stackCount = existingCount ?? document.createElement('span');
        stackCount.dataset.toastStackCount = '';
        stackCount.className = 'toast-stack-count';
        const countLabel = m.ui_toast_stackMore_label({ count: visibleToasts.length - 1 });
        if (stackCount.textContent !== countLabel) stackCount.textContent = countLabel;
        if (!existingCount) toastElement.insertBefore(stackCount, closeButton ?? null);
      }
    };
    const observer = new MutationObserver(updateVisibleToastCount);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-visible', 'data-removed', 'data-front'],
    });
    updateVisibleToastCount();
    return () => {
      themeObserver?.disconnect();
      observer.disconnect();
    };
  });

  function clearVisibleToasts() {
    if (onClearAll) onClearAll();
    else toast.dismiss();
    visibleToastCount = 0;
  }
</script>

<!-- The wrapper div owns the `app-toast-region` DOM id: since svelte-sonner
     1.2.0 the `id` prop identifies the toaster for `toast(..., { toasterId })`
     targeting (an id-bearing toaster renders ONLY matching toasts) and is no
     longer applied to the <ol> element, so it must not be passed here. The
     MutationObserver selector and the Clear-all `aria-controls` anchor on this
     div instead.

     Sonner's collapsed stack stays enabled so prior cards remain visible as
     progressively smaller peeks until hover or keyboard interaction expands it. -->
<div
  bind:this={regionElement}
  id={regionId}
  class:toast-static={staticPosition}
  data-surface-level={surface}
  style="--toast-surface: {SURFACE_VALUE[surface]}"
>
  <Sonner
    id={toasterId}
    theme={$isDarkTheme ? 'dark' : 'light'}
    class="toaster group"
    style="--app-toast-width: min(22rem, calc(100vw - clamp(2rem, 8vw, 4rem)))"
    {offset}
    {mobileOffset}
    {containerAriaLabel}
    closeButtonAriaLabel={m.ui_toast_close_ariaLabel()}
    toastOptions={{
      classes: {
        toast: `group toast w-full min-w-0 max-w-full group-[.toaster]:text-foreground ${surfaceClasses(surface)}`,
        description: 'group-[.toast]:text-subtle',
        actionButton: 'toast-action-button',
        cancelButton:
          'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted',
        action: 'font-medium',
      },
    }}
    {position}
    closeButton
    duration={10000}
    gap={8}
  >
    {#snippet successIcon()}<ToastGlyph variant="success" />{/snippet}
    {#snippet errorIcon()}<ToastGlyph variant="error" />{/snippet}
    {#snippet warningIcon()}<ToastGlyph variant="warning" />{/snippet}
    {#snippet infoIcon()}<ToastGlyph variant="info" />{/snippet}
    {#snippet loadingIcon()}<ToastGlyph variant="loading" />{/snippet}
    {#snippet closeIcon()}<XIcon size={16} aria-hidden="true" />{/snippet}
  </Sonner>
</div>

{#if showClearAll}
  <Button
    variant="ghost"
    size="lg"
    class={staticPosition ? 'toast-clear-all toast-clear-all-static' : 'toast-clear-all'}
    onclick={clearVisibleToasts}
    aria-controls={regionId}
    aria-label={m.ui_toast_clearAll_ariaLabel({ count: toastCount })}
  >
    {m.ui_toast_clearAll_label()}
  </Button>
{/if}

<style>
  :global([data-sonner-toaster]) {
    --toast-radius: var(--radius);
    --toast-padding: 0.75rem 0.875rem;
    --toast-min-height: 2.75rem;
    --toast-title-size: 0.8125rem;
    --toast-description-size: 0.8125rem;
    --toast-action-height: var(--control-height-compact);
    --toast-action-radius: var(--radius);
    --toast-shadow: var(--elevation-overlay);
    --width: var(--app-toast-width) !important;
    width: var(--app-toast-width) !important;
  }

  .toast-static {
    width: min(100%, 22rem);
    justify-self: start;
  }

  .toast-static :global([data-sonner-toaster]) {
    position: relative !important;
    inset: auto !important;
    transform: none !important;
    height: calc(var(--front-toast-height) + 1rem) !important;
    padding-top: 1rem !important;
  }

  .toast-static :global([data-sonner-toast]) {
    width: 100% !important;
  }

  :global([data-sonner-toast]) {
    /* background-COLOR, not the shorthand: the countdown bar (below) animates
       background-size on opted-in toasts, and an !important shorthand here
       would lock every background longhand (CSS animations cannot override
       !important declarations). */
    background-color: hsl(var(--toast-surface)) !important;
    color: hsl(var(--foreground)) !important;
    /* Width/style stay !important, but color must NOT be — per-toast Tailwind
       classes (e.g. !border-danger/50 on custom toasts) override it.
       This also relies on these :global styles staying UNLAYERED: moving them
       into a cascade layer would change the fallback chain for default toasts. */
    border: 1px solid hsl(var(--foreground) / 0.05) !important;
    border-radius: var(--toast-radius) !important;
    width: var(--app-toast-width) !important;
    min-width: 0;
    max-width: 100%;
    min-height: var(--toast-min-height) !important;
    padding: var(--toast-padding) !important;
    align-items: center !important;
    gap: 0.625rem !important;
    box-shadow: var(--toast-shadow) !important;
  }

  :global([data-sonner-toast][data-swiping='false']) {
    transition:
      transform var(--spring-moderate) var(--spring-moderate-ease),
      opacity var(--spring-moderate) var(--spring-moderate-ease),
      height var(--spring-moderate) var(--spring-moderate-ease),
      box-shadow var(--spring-fast) var(--spring-fast-ease) !important;
  }

  :global([data-sonner-toast][data-removed='true'][data-swiping='false']) {
    transition:
      transform var(--spring-fast-exit) var(--spring-exit-ease),
      opacity var(--spring-fast-exit) var(--spring-exit-ease),
      height var(--spring-fast-exit) var(--spring-exit-ease),
      box-shadow var(--spring-fast-exit) var(--spring-exit-ease) !important;
  }

  :global([data-sonner-toast] [data-icon]) {
    width: 1rem !important;
    height: 1rem !important;
    margin: 0 !important;
  }

  :global([data-sonner-toast] [data-title]) {
    color: hsl(var(--foreground)) !important;
    font-size: var(--toast-title-size);
    font-weight: 500 !important;
    line-height: 1.35 !important;
  }

  :global([data-sonner-toast] [data-description]) {
    color: hsl(var(--muted-foreground)) !important;
    font-size: var(--toast-description-size);
    font-weight: 400 !important;
    line-height: 1.4 !important;
    margin-top: 0.25rem;
  }

  :global([data-sonner-toast][data-type='loading'] [data-content]) {
    flex-direction: row !important;
    align-items: baseline;
    gap: 0 !important;
  }

  :global([data-sonner-toast][data-type='loading'] [data-description]) {
    margin-top: 0;
    margin-left: 0.25rem;
    font-size: var(--toast-description-size);
  }

  :global([data-sonner-toast] [data-content]),
  :global([data-sonner-toast] [data-title]),
  :global([data-sonner-toast] [data-description]) {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* Sonner owns this button element, so mirror Button's inset surface recipe. */
  :global([data-sonner-toast] button[data-button]) {
    font-size: 0.75rem !important;
    line-height: 0.8125rem !important;
    min-height: var(--toast-action-height) !important;
    font-weight: 500 !important;
    padding: 0 0.625rem !important;
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border-radius: var(--toast-action-radius) !important;
    transition:
      color var(--spring-fast) var(--spring-fast-ease),
      opacity var(--spring-fast) var(--spring-fast-ease) !important;
    border: 1px solid hsl(var(--border)) !important;
    background: transparent !important;
    color: hsl(var(--foreground)) !important;
    outline: none;
  }

  :global([data-sonner-toast] button[data-button]:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none !important;
  }

  :global([data-sonner-toast] button[data-button]::before) {
    position: absolute;
    z-index: -1;
    inset: 0;
    border-radius: inherit;
    background: transparent;
    box-shadow: 0 0 0 1px hsl(var(--border));
    content: '';
    transition:
      inset var(--spring-fast) var(--spring-fast-ease),
      background-color var(--spring-fast) var(--spring-fast-ease),
      box-shadow var(--spring-fast) var(--spring-fast-ease);
  }

  :global([data-sonner-toast] button[data-button]:hover) {
    background: transparent !important;
    border-color: hsl(var(--border)) !important;
  }

  :global([data-sonner-toast] button[data-button]:hover::before) {
    background: var(--hover);
  }

  :global([data-sonner-toast] button[data-button]:active::before) {
    inset: var(--press-inset);
    background: var(--active);
    box-shadow: 0 0 0 0 hsl(var(--border));
  }

  /* Close button styling */
  :global([data-sonner-toast] [data-close-button]) {
    color: hsl(var(--muted-foreground)) !important;
    width: 1.5rem !important;
    height: 1.5rem !important;
    top: 50% !important;
    right: 0.5rem !important;
    left: auto !important;
    border: 0 !important;
    border-radius: var(--toast-action-radius) !important;
    background: transparent !important;
    transform: translateY(-50%) !important;
  }

  :global([data-sonner-toast] [data-close-button] svg) {
    width: 1rem;
    height: 1rem;
  }

  :global([data-sonner-toast] [data-close-button]:hover) {
    background: var(--hover) !important;
  }

  :global([data-sonner-toast] [data-close-button]:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none !important;
  }

  :global([data-sonner-toaster][dir='ltr']) {
    --toast-close-button-start: unset;
    --toast-close-button-end: 0;
    --toast-close-button-transform: translateY(-50%);
  }

  :global(.toast-stack-count) {
    margin-left: auto;
    margin-right: 2.5rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
    white-space: nowrap;
  }

  :global([data-sonner-toast][data-expanded='false'][data-front='false'][data-visible='true']) {
    filter: saturate(0.8) brightness(0.96);
  }

  :global(.toast-clear-all) {
    position: fixed;
    left: calc(2rem + var(--app-toast-width));
    bottom: 2rem;
    z-index: 1000000000;
    transform: translateX(-100%);
    color: hsl(var(--muted-foreground));
  }

  :global(.toast-clear-all.toast-clear-all-static) {
    position: relative;
    inset: auto;
    margin-top: 0.5rem;
    margin-left: auto;
    transform: none;
  }

  :global(.toast-clear-all:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
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
    background-size: 100% 3px;
    animation: toast-countdown-shrink var(--toast-countdown-duration, 10000ms) linear forwards;
  }

  /* Undo/warning toasts tint the bar with the same accent as their border.
     The [data-sonner-toaster] prefix ties specificity (0,4,0) with the base
     rule above (whose :not() argument counts); later source order wins. */
  :global([data-sonner-toaster] [data-sonner-toast][data-type='warning'].toast-countdown) {
    --toast-countdown-color: hsl(var(--warning));
  }

  :global([data-sonner-toast][data-type='warning'].toast-countdown button[data-button]::after) {
    padding: 0.125rem 0.375rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    margin-left: 0.375rem;
    background: var(--hover);
    color: hsl(var(--muted-foreground));
    content: '⌘Z';
    font-size: 0.6875rem;
    line-height: 1;
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
    :global([data-sonner-toast][data-swiping='false']),
    :global([data-sonner-toast] button[data-button]),
    :global([data-sonner-toast] button[data-button]::before) {
      transition: none !important;
    }

    :global(
      [data-sonner-toaster] [data-sonner-toast].toast-countdown:not([data-swipe-out='true'])
    ) {
      /* No moving bar — the static full-width bar from background-size stays. */
      animation: none;
    }
  }

  @keyframes -global-toast-countdown-shrink {
    from {
      background-size: 100% 3px;
    }
    to {
      background-size: 0% 3px;
    }
  }
</style>

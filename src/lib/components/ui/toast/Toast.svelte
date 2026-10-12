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
  let activeToastCount = $state(0);
  let visibleToastLimit = $state(3);
  let toastCount = $derived(staticToastCount ?? activeToastCount);
  let showClearAll = $derived(toastCount >= 2);
  let offset = $derived({
    bottom: showClearAll ? 'calc(1rem + var(--control-height-large) + 0.5rem)' : 16,
    left: 16,
  });
  let mobileOffset = $derived(offset);
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
    const observedElements = new Set<HTMLElement>();
    const resizeObserver = new ResizeObserver(() => updateToasts());
    const updateToasts = () => {
      for (const card of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toast]')) {
        card.inert =
          card.dataset.removed === 'true' ||
          card.dataset.visible === 'false' ||
          (card.dataset.front === 'false' && card.dataset.expanded === 'false');
      }
      const activeToasts = Array.from(
        regionElement.querySelectorAll<HTMLElement>(
          '[data-sonner-toast]:not([data-removed="true"])',
        ),
      );
      activeToastCount = activeToasts.length;

      const elements = activeToasts.flatMap((card) => [
        card,
        ...card.querySelectorAll<HTMLElement>(
          ':scope > *, [data-title], [data-description], [data-toast-title], [data-toast-description]',
        ),
      ]);
      for (const element of observedElements) {
        if (!elements.includes(element)) {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
        }
      }
      for (const element of elements) {
        if (!observedElements.has(element)) {
          resizeObserver.observe(element);
          observedElements.add(element);
        }
      }

      for (const toastElement of activeToasts) {
        const closeButton = toastElement.querySelector<HTMLElement>(':scope > [data-close-button]');
        if (closeButton && toastElement.lastElementChild !== closeButton) {
          toastElement.append(closeButton);
        }
        const title = toastElement.querySelector<HTMLElement>('[data-title]');
        if (title) {
          const actions = Array.from(
            toastElement.querySelectorAll<HTMLElement>(
              ':scope > [data-button], .toast-undo-action',
            ),
          );
          const style = getComputedStyle(toastElement);
          const controlsWidth = actions.reduce(
            (width, action) => width + Math.max(action.scrollWidth, action.offsetWidth) + 10,
            0,
          );
          const requiredWidth =
            controlsWidth +
            (toastElement.querySelector('[data-icon]') ? 26 : 0) +
            (closeButton ? 32 : 0) +
            Number.parseFloat(style.paddingLeft) +
            Number.parseFloat(style.paddingRight) +
            Math.min(96, title.scrollWidth);
          toastElement.toggleAttribute(
            'data-toast-footer',
            requiredWidth > toastElement.clientWidth,
          );
        }
        for (const text of toastElement.querySelectorAll<HTMLElement>(
          '[data-title], [data-description], [data-toast-title], [data-toast-description]',
        )) {
          if (text.textContent) text.title = text.textContent.trim();
        }
      }

      for (const toaster of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toaster]')) {
        const style = getComputedStyle(toaster);
        const availableHeight = `calc(100dvh - ${style.getPropertyValue('--offset-top')} - ${style.getPropertyValue('--offset-bottom')})`;
        if (toaster.style.getPropertyValue('--toast-available-height') !== availableHeight) {
          toaster.style.setProperty('--toast-available-height', availableHeight);
        }
      }

      const heights = new Map<HTMLElement, number>();
      for (const card of activeToasts) {
        card.setAttribute('data-toast-measuring', '');
        for (let level = 0; level <= 3; level += 1) {
          card.dataset.toastCompact = String(level);
          if (
            card.scrollHeight <= card.clientHeight + 1 &&
            card.scrollWidth <= card.clientWidth + 1
          ) {
            break;
          }
        }
        heights.set(card, card.offsetHeight);
        card.removeAttribute('data-toast-measuring');
      }

      let limit = 3;
      for (const toaster of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toaster]')) {
        const cards = activeToasts
          .filter((card) => card.parentElement === toaster)
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
        let stackHeight = 0;
        for (const card of cards) {
          const stackOffset = `${stackHeight}px`;
          if (card.style.getPropertyValue('--toast-stack-offset') !== stackOffset) {
            card.style.setProperty('--toast-stack-offset', stackOffset);
          }
          stackHeight += (heights.get(card) ?? 0) + 8;
        }
        const frontHeight = `${cards[0] ? heights.get(cards[0]) : 0}px`;
        if (toaster.style.getPropertyValue('--toast-front-height') !== frontHeight) {
          toaster.style.setProperty('--toast-front-height', frontHeight);
        }
        toaster.toggleAttribute('data-toast-sized', cards.length > 0);
        if (!initialStaticPosition) {
          const style = getComputedStyle(toaster);
          const edge = toaster.dataset.yPosition === 'top' ? style.top : style.bottom;
          const availableHeight = window.innerHeight - (Number.parseFloat(edge) || 0) - 16;
          let height = 0;
          let count = 0;
          for (const card of cards.slice(0, 3)) {
            height += (heights.get(card) ?? 0) + (count ? 8 : 0);
            if (height > availableHeight && count) break;
            count += 1;
          }
          limit = Math.min(limit, Math.max(1, count));
        }
      }
      visibleToastLimit = limit;
    };
    const observer = new MutationObserver(updateToasts);
    observer.observe(regionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-visible',
        'data-removed',
        'data-front',
        'data-expanded',
        'style',
        'open',
      ],
    });
    window.addEventListener('resize', updateToasts);
    updateToasts();
    return () => {
      themeObserver?.disconnect();
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateToasts);
    };
  });

  function clearVisibleToasts() {
    if (onClearAll) onClearAll();
    else toast.dismiss();
    activeToastCount = 0;
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
    visibleToasts={visibleToastLimit}
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
    variant="secondary"
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
    --toast-max-height: min(16rem, 50dvh, var(--toast-available-height, 100dvh));
    --toast-title-size: 0.8125rem;
    --toast-description-size: 0.8125rem;
    --toast-action-height: var(--control-height-compact);
    --toast-action-radius: var(--radius);
    --toast-shadow: var(--elevation-overlay);
    --width: var(--app-toast-width) !important;
    width: var(--app-toast-width) !important;
  }

  :global([data-sonner-toaster][data-toast-sized]) {
    --front-toast-height: var(--toast-front-height) !important;
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
    /* The wrapper's single neutral border is shared by standard and custom
       content-only toasts. These :global styles must stay UNLAYERED: moving
       them into a cascade layer would change the default toast chrome. */
    border: 1px solid hsl(var(--foreground) / 0.05) !important;
    border-radius: var(--toast-radius) !important;
    width: var(--app-toast-width) !important;
    min-width: 0;
    max-width: 100%;
    min-height: var(--toast-min-height) !important;
    max-height: var(--toast-max-height) !important;
    padding: var(--toast-padding) !important;
    align-items: center !important;
    gap: 0.625rem !important;
    box-shadow: var(--toast-shadow) !important;
  }

  :global([data-sonner-toast][data-toast-measuring]),
  :global([data-sonner-toast][data-front='true']:not([data-removed='true'])),
  :global([data-sonner-toast][data-expanded='true']:not([data-removed='true'])) {
    height: auto !important;
  }

  :global([data-sonner-toast][data-expanded='true']:not([data-removed='true'])) {
    --offset: var(--toast-stack-offset, 0px) !important;
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

  :global([data-sonner-toast] [data-title]),
  :global([data-sonner-toast] [data-toast-title]),
  :global([data-sonner-toast] [data-description]),
  :global([data-sonner-toast] [data-toast-description]) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--toast-title-lines, 2);
    line-clamp: var(--toast-title-lines, 2);
    min-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  :global([data-sonner-toast] [data-description]),
  :global([data-sonner-toast] [data-toast-description]) {
    -webkit-line-clamp: var(--toast-description-lines, 3);
    line-clamp: var(--toast-description-lines, 3);
  }

  :global([data-sonner-toast][data-toast-compact='1']),
  :global([data-sonner-toast][data-toast-compact='2']),
  :global([data-sonner-toast][data-toast-compact='3']) {
    --toast-title-lines: 1;
    --toast-description-lines: 1;
  }

  :global([data-sonner-toast][data-toast-compact='2'] [data-toast-optional]),
  :global([data-sonner-toast][data-toast-compact='3'] [data-toast-optional]),
  :global([data-sonner-toast][data-toast-compact='3'] [data-description]),
  :global([data-sonner-toast][data-toast-compact='3'] [data-toast-description]) {
    display: none;
  }

  :global([data-sonner-toast][data-toast-compact='3']) {
    --toast-padding: 0.375rem 0.875rem;
  }

  :global([data-sonner-toast][data-toast-compact='3'] .toast-actions) {
    margin-top: var(--space-1);
  }

  /* Standard toasts share one header row, independent of description height.
     Empty action tracks collapse; margins belong only to controls that exist. */
  :global([data-sonner-toast][data-styled='true']) {
    --toast-header-height: 1.5rem;
    display: grid !important;
    align-items: start !important;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    column-gap: 0 !important;
    row-gap: 0 !important;
  }

  :global([data-sonner-toast][data-styled='true']:has([data-button], .toast-undo-action)) {
    --toast-header-height: var(--toast-action-height);
  }

  :global([data-sonner-toast][data-styled='true'] > [data-content]) {
    display: contents !important;
  }

  :global([data-sonner-toast][data-styled='true'] > [data-icon]) {
    grid-area: 1 / 1;
    margin-top: calc((var(--toast-header-height) - 1rem) / 2) !important;
    margin-right: calc(var(--space-1) * 2.5) !important;
  }

  :global([data-sonner-toast][data-styled='true'] [data-title]) {
    grid-area: 1 / 2;
    margin-top: max(0px, calc((var(--toast-header-height) - var(--toast-title-size) * 1.35) / 2));
  }

  :global([data-sonner-toast][data-styled='true'] [data-description]) {
    grid-row: 2;
    grid-column: 2 / -1;
  }

  :global([data-sonner-toast][data-styled='true'] > button:not([data-close-button])),
  :global([data-sonner-toast][data-styled='true'] .toast-undo-action) {
    grid-area: 1 / 4;
    margin-left: calc(var(--space-1) * 2.5) !important;
  }

  :global([data-sonner-toast][data-styled='true'] > button[data-cancel]) {
    grid-column: 3;
  }

  :global([data-sonner-toast][data-styled='true'] > [data-close-button]) {
    grid-area: 1 / 5;
    position: static !important;
    transform: none !important;
    margin-top: calc((var(--toast-header-height) - 1.5rem) / 2) !important;
    margin-left: var(--space-2);
  }

  :global([data-sonner-toast][data-styled='true'][data-toast-footer]) {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto;
  }

  :global([data-sonner-toast][data-styled='true'][data-toast-footer] [data-title]) {
    grid-column: 2 / 4;
  }

  :global([data-sonner-toast][data-styled='true'][data-toast-footer] > [data-close-button]) {
    grid-column: 4;
  }

  :global([data-sonner-toast][data-styled='true'][data-toast-footer] > [data-button]),
  :global([data-sonner-toast][data-styled='true'][data-toast-footer] .toast-undo-action) {
    grid-area: 3 / 2 / auto / 4;
    justify-self: start;
    min-width: 0;
    max-width: 100%;
    margin-left: 0 !important;
    margin-top: var(--space-2);
  }

  :global(
    [data-sonner-toast][data-styled='true'][data-toast-footer]:has([data-cancel]) > [data-button]
  ) {
    grid-column: 3;
    margin-left: var(--space-2) !important;
    max-width: calc(100% - var(--space-2));
  }

  :global([data-sonner-toast][data-styled='true'][data-toast-footer] > [data-button][data-cancel]) {
    grid-column: 2;
    margin-left: 0 !important;
  }

  :global([data-sonner-toast] [data-content]),
  :global([data-sonner-toast] [data-title]),
  :global([data-sonner-toast] [data-description]) {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* Sonner owns this button element, so mirror Button's inset surface recipe. */
  :global([data-sonner-toast] button[data-button]) {
    display: block !important;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  :global([data-sonner-toast] .toast-actions .toast-action) {
    min-width: 0;
    max-width: 100%;
  }

  :global([data-sonner-toast][data-styled='false'] .toast-actions) {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
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

  :global([data-sonner-toast][data-expanded='false'][data-front='false'][data-visible='true']) {
    filter: saturate(0.8) brightness(0.96);
  }

  /* Sonner conceals standard children when a rear card takes the front card's
     height, but custom components opt out of its styled-content selector. Keep
     their card peek while hiding text/actions until hover or hotkey expansion. */
  :global([data-sonner-toast][data-styled='false'][data-expanded='false'][data-front='false'] > *) {
    opacity: 0;
    pointer-events: none;
  }

  /* display:contents has no box for Sonner's parent opacity rule to conceal. */
  :global(
    [data-sonner-toast][data-styled='true'][data-expanded='false'][data-front='false']
      [data-content]
      > *
  ),
  :global(
    [data-sonner-toast][data-styled='true'][data-expanded='false'][data-front='false']
      .toast-undo-action
  ) {
    opacity: 0;
    pointer-events: none;
  }

  :global(.toast-clear-all) {
    position: fixed;
    left: var(--space-4);
    bottom: var(--space-4);
    z-index: 1000000000;
  }

  :global(.toast-clear-all.toast-clear-all-static) {
    position: relative;
    inset: auto;
    margin-top: var(--space-2);
    margin-right: auto;
  }

  :global(.toast-clear-all:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
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

  @container style(--motion-reduced: 1) {
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

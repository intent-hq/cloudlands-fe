<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Portal from './Portal.svelte';
  import Button from './button/button.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';

  interface Props {
    open?: boolean;
    ariaLabel: string;
    closeLabel: string;
    onClose?: () => void;
    openerElement?: HTMLElement | null;
    children: Snippet;
    actions?: Snippet;
    caption?: string;
    onKeydown?: (event: KeyboardEvent) => void;
  }

  let {
    open = $bindable(false),
    ariaLabel,
    closeLabel,
    onClose,
    openerElement = null,
    children,
    actions,
    caption,
    onKeydown,
  }: Props = $props();

  let dialogElement: HTMLDivElement | null = $state(null);
  let closeButtonElement: HTMLButtonElement | null = $state(null);
  let prefersReducedMotion = $state(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );

  function close() {
    open = false;
    onClose?.();
    if (openerElement?.isConnected) openerElement.focus({ preventScroll: true });
  }

  function handleBackdropClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-media-lightbox-content], [role="toolbar"], button, input')) return;
    close();
  }

  function handleKeydown(event: KeyboardEvent) {
    onKeydown?.(event);
    if (event.defaultPrevented || event.key !== 'Tab' || !dialogElement) return;

    const focusable = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;
    const updatePreference = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
    };
    mediaQuery.addEventListener?.('change', updatePreference);
    return () => mediaQuery.removeEventListener?.('change', updatePreference);
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer(close);
  });

  $effect(() => {
    if (!open || !closeButtonElement) return;
    requestAnimationFrame(() => closeButtonElement?.focus());
  });
</script>

{#if open}
  <Portal target="body" zIndex={1000}>
    <div
      bind:this={dialogElement}
      data-media-lightbox-root
      data-image-lightbox-root
      class="fixed inset-0 z-[1000] flex cursor-zoom-out flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style="pointer-events: auto;"
      onclick={handleBackdropClick}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabindex="-1"
      transition:fade={{ duration: prefersReducedMotion ? 0 : 200 }}
    >
      <div class="absolute right-4 top-4 z-[1002] flex items-center gap-1">
        {#if actions}
          {@render actions()}
        {/if}
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/20 hover:text-white"
          onclick={close}
          aria-label={closeLabel}
          bind:ref={closeButtonElement}
        >
          <Fa icon={faXmark} size="lg" />
        </Button>
      </div>

      <div class="flex min-h-0 w-full flex-1 items-center justify-center">
        {@render children()}
      </div>
      {#if caption}
        <p
          class="mt-2 max-w-[90vw] rounded-md bg-black/60 px-3 py-1.5 text-center text-sm text-white"
        >
          {caption}
        </p>
      {/if}
    </div>
  </Portal>
{/if}

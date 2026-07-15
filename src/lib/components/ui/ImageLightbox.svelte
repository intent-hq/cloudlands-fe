<script lang="ts">
  /**
   * ImageLightbox - Full-screen image preview lightbox
   *
   * Opens images in a full-screen overlay with dark backdrop.
   * Closes on Escape, backdrop click, or X button.
   * Keyboard accessible with focus trap and focus return.
   */
  import { fade } from 'svelte/transition';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Portal from './Portal.svelte';
  import Button from './button/button.svelte';

  interface Props {
    open?: boolean;
    imageUrl: string;
    imageName?: string;
    onClose?: () => void;
    /** Element that opened the lightbox, to return focus on close */
    openerElement?: HTMLElement | null;
  }

  let {
    open = $bindable(false),
    imageUrl,
    imageName = 'Image',
    onClose,
    openerElement = null,
  }: Props = $props();

  let closeButtonElement: HTMLButtonElement | null = $state(null);
  let dialogElement: HTMLDivElement | null = $state(null);

  function close() {
    open = false;
    onClose?.();
    // Return focus to the element that opened the lightbox
    if (openerElement && openerElement.isConnected) {
      openerElement.focus();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    // Only close if clicking the backdrop itself, not the image
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Manual focus trap: Tab and Shift+Tab cycle between focusable elements
    if (e.key === 'Tab') {
      if (!dialogElement) return;

      const focusableElements = dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const focusableArray = Array.from(focusableElements);

      if (focusableArray.length === 0) return;

      const firstFocusable = focusableArray[0];
      const lastFocusable = focusableArray[focusableArray.length - 1];
      const activeElement = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }
  }

  // Global keydown listener for Escape key
  $effect(() => {
    if (!open) return;

    function handleGlobalKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }

    window.addEventListener('keydown', handleGlobalKeydown, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalKeydown, { capture: true });
  });

  // Focus management: move focus into dialog on open
  $effect(() => {
    if (open && closeButtonElement) {
      // Use requestAnimationFrame to ensure the Portal is fully mounted
      requestAnimationFrame(() => {
        closeButtonElement?.focus();
      });
    }
  });
</script>

{#if open}
  <Portal target="body" zIndex={1000}>
    <!-- Backdrop -->
    <div
      bind:this={dialogElement}
      class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[1000] flex items-center justify-center cursor-zoom-out"
      onclick={handleBackdropClick}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      tabindex="-1"
      transition:fade={{ duration: 200 }}
    >
      <!-- Close button -->
      <Button
        variant="ghost"
        size="icon"
        class="absolute top-4 right-4 z-[1002] text-white hover:bg-white/20"
        onclick={close}
        aria-label="Close preview"
        bind:ref={closeButtonElement}
      >
        <Fa icon={faXmark} size="lg" />
      </Button>

      <!-- Image container -->
      <div
        class="max-w-[90vw] max-h-[90vh] flex items-center justify-center p-4"
        onclick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <img
          src={imageUrl}
          alt={imageName}
          class="max-w-full max-h-full object-contain cursor-default"
          style="max-height: 90vh;"
        />
      </div>
    </div>
  </Portal>
{/if}

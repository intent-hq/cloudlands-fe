<script lang="ts">
  /**
   * ToastCloseButton - Shared floating-circle close button for custom toasts.
   *
   * Matches Sonner's built-in close button: a 20px bordered circle anchored at
   * the toast's top-right corner (offsets account for the toast padding
   * 1rem/1.25rem). The host's content wrapper must be `position: relative`.
   */

  interface Props {
    onclick: () => void;
    ariaLabel: string;
  }

  let { onclick, ariaLabel }: Props = $props();
</script>

<button type="button" class="toast-close-btn" {onclick} aria-label={ariaLabel}>
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
</button>

<style>
  .toast-close-btn {
    position: absolute;
    top: -1rem;
    right: -1.25rem;
    transform: translate(35%, -35%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    color: hsl(var(--muted-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: opacity 0.15s ease;
    z-index: 1;
  }

  .toast-close-btn:hover {
    opacity: 0.8;
  }

  .toast-close-btn:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
</style>

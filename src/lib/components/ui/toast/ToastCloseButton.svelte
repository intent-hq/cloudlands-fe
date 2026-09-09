<script lang="ts">
  import { Button } from '$lib/components/ui/button';

  /** Shared, inset close action for custom toasts. */

  interface Props {
    onclick: () => void;
    ariaLabel: string;
  }

  let { onclick, ariaLabel }: Props = $props();
</script>

<Button
  variant="ghost"
  size="icon-lg"
  iconOnly
  class="toast-close-btn"
  {onclick}
  aria-label={ariaLabel}
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
</Button>

<style>
  :global(.toast-close-btn) {
    position: absolute;
    top: -0.75rem;
    right: -0.75rem;
    width: 2.5rem;
    height: 2.5rem;
    border: 0;
    border-radius: var(--toast-action-radius, 0.625rem);
    background: transparent;
    color: hsl(var(--muted-foreground));
    padding: 0;
    z-index: 2;
  }

  :global(.toast-close-btn:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>

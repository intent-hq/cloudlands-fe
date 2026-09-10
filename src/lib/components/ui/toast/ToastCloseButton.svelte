<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  /** Shared, inset close action for custom toasts. */

  interface Props {
    onclick: () => void;
    ariaLabel: string;
  }

  let { onclick, ariaLabel }: Props = $props();
</script>

<Button
  variant="ghost"
  size="icon-compact"
  iconOnly
  class="toast-close-btn"
  {onclick}
  aria-label={ariaLabel}
>
  <XIcon size={16} aria-hidden="true" />
</Button>

<style>
  :global(.toast-close-btn) {
    position: absolute;
    top: 50%;
    right: -0.375rem;
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    border-radius: var(--toast-action-radius, var(--radius));
    background: transparent;
    color: hsl(var(--muted-foreground));
    padding: 0;
    transform: translateY(-50%);
    z-index: 2;
  }

  :global(.toast-close-btn:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  let { onclick = () => undefined }: { onclick?: () => void } = $props();
</script>

<Button variant="outline" size="default" class="toast-undo-action" {onclick}>
  <span>{m.ui_reversibleActions_undo_label()}</span>
  <kbd data-toast-shortcut>⌘Z</kbd>
</Button>

<style>
  :global(.toast-undo-action) {
    min-height: var(--toast-action-height, 2.5rem);
    border-radius: var(--toast-action-radius, 0.625rem);
  }

  :global(.toast-undo-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }

  kbd {
    padding: 0.125rem 0.375rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: var(--hover);
    color: hsl(var(--muted-foreground));
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1;
  }
</style>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import MicroKeySlotSquare from '$features/hardware-console/components/MicroKeySlotSquare.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Kind-flavored headline, e.g. "Implementor requests a discussion". */
    title: string;
    /** Truncated attention-request reason from the agent. */
    reason: string;
    /** "discussion" | "blocker" — picks the icon/tint. */
    kind: 'discussion' | 'blocker';
    /** ISO timestamp when the request was raised — renders a live "X ago". */
    timestamp?: string;
    /** Resolved 0-based micro key slot of the workspace (badge hidden when null). */
    keySlot?: number | null;
    onSwitchTo: () => void;
    onClose: () => void;
  }

  let { title, reason, kind, timestamp, keySlot = null, onSwitchTo, onClose }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the shared card chrome (bg, neutral border, padding). -->
<div
  class="relative flex w-full min-w-0 items-start gap-2.5 pr-6"
  data-toast-layout="agent-attention"
>
  <ToastGlyph variant={kind === 'blocker' ? 'warning' : 'discussion'} />

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-1.5">
      {#if keySlot != null}
        <MicroKeySlotSquare slot={keySlot} />
      {/if}
      <p class="toast-title min-w-0 break-words">
        {title}
        {#if timestamp}
          <RelativeTime date={timestamp} class="ml-1 text-xs font-normal text-muted-foreground" />
        {/if}
      </p>
    </div>
    <p class="toast-description line-clamp-3 break-words">{reason}</p>

    <!-- Action buttons -->
    <div class="toast-actions">
      <Button variant="primary" size="compact" class="toast-action" onclick={onSwitchTo}>
        {m.agent_attentionToast_switchTo_label()}
      </Button>
      <Button variant="ghost" size="compact" class="toast-action" onclick={onClose}>
        {m.agent_attentionToast_later_label()}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <ToastCloseButton onclick={onClose} ariaLabel={m.agent_attentionToast_close_ariaLabel()} />
</div>

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .toast-title {
    color: hsl(var(--foreground));
    font-size: var(--toast-title-size, 0.8125rem);
    font-weight: 500;
    line-height: 1.4;
  }

  .toast-description {
    margin-top: 0.25rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--toast-description-size, 0.8125rem);
    font-weight: 400;
    line-height: 1.4;
  }

  .toast-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  :global(.toast-action) {
    min-height: var(--toast-action-height, var(--control-height-compact));
    border-radius: var(--toast-action-radius, var(--radius));
  }

  :global(.toast-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>

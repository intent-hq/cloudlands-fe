<script lang="ts">
  import Fa from 'svelte-fa';
  import { faComments, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
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
    onSwitchTo: () => void;
    onClose: () => void;
  }

  let { title, reason, kind, timestamp, onSwitchTo, onClose }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the kind-flavored border tint is passed as a wrapper class by the service. -->
<div class="flex items-start gap-3 max-w-[500px]">
  <!-- Icon -->
  <div class="flex-shrink-0 mt-0.5 {kind === 'blocker' ? 'text-destructive' : 'text-primary'}">
    <Fa icon={kind === 'blocker' ? faTriangleExclamation : faComments} class="w-5 h-5" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground">
      {title}
      {#if timestamp}
        <RelativeTime date={timestamp} class="text-xs font-normal text-muted-foreground ml-1" />
      {/if}
    </p>
    <p class="text-sm text-muted-foreground line-clamp-3 mt-0.5">{reason}</p>

    <!-- Action buttons -->
    <div class="flex items-center gap-2 mt-3">
      <Button variant="outline" size="sm" onclick={onSwitchTo}>
        {m.agent_attentionToast_switchTo_label()}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={onClose}
    aria-label={m.agent_attentionToast_close_ariaLabel()}
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  </button>
</div>

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

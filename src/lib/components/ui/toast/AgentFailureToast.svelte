<script lang="ts">
  import Fa from 'svelte-fa';
  import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import MicroKeySlotSquare from '$features/hardware-console/components/MicroKeySlotSquare.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Headline, e.g. "Implementor failed". */
    title: string;
    /** Truncated error message for the failed agent. */
    errorSummary: string;
    /** Resolved "Agent — Workspace" context line (absent when unresolvable). */
    contextLine?: string;
    /** "Retry <name>" (or plain "Retry" when the name is unresolvable). */
    retryLabel: string;
    /** Disables the retry button while the retry is in flight. */
    retrying: boolean;
    /** Brief note when the retry failed (entry kept in the registry). */
    retryNote?: string;
    /** Resolved 0-based micro key slot of the workspace (badge hidden when null). */
    keySlot?: number | null;
    onRetry: () => void;
    /** Navigate to the agent WITHOUT retrying. */
    onSwitchTo: () => void;
    onClose: () => void;
  }

  let {
    title,
    errorSummary,
    contextLine,
    retryLabel,
    retrying,
    retryNote,
    keySlot = null,
    onRetry,
    onSwitchTo,
    onClose,
  }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the destructive border tint is passed as a wrapper class by the service. -->
<div class="relative flex w-full min-w-0 items-start gap-3">
  <!-- Icon -->
  <div class="flex-shrink-0 mt-0.5 text-danger">
    <Fa icon={faExclamationCircle} class="w-5 h-5" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-1.5">
      {#if keySlot != null}
        <MicroKeySlotSquare slot={keySlot} />
      {/if}
      <p class="min-w-0 break-words text-sm font-medium text-foreground">{title}</p>
    </div>
    <p class="text-sm text-muted-foreground line-clamp-2 mt-0.5 break-words">{errorSummary}</p>

    {#if contextLine}
      <p class="text-xs text-muted-foreground truncate mt-1.5 min-w-0">{contextLine}</p>
    {/if}

    {#if retryNote}
      <p class="text-xs text-danger mt-1.5 break-words">{retryNote}</p>
    {/if}

    <!-- Action buttons -->
    <div class="flex flex-wrap items-center gap-2 mt-3">
      <Button variant="outline" size="sm" disabled={retrying} onclick={onRetry}>
        {retrying ? m.ui_agentFailureToast_retrying_label() : retryLabel}
      </Button>
      <Button variant="ghost" size="sm" onclick={onSwitchTo}>
        {m.agent_failureToast_switchTo_label()}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <ToastCloseButton onclick={onClose} ariaLabel={m.ui_agentFailureToast_close_ariaLabel()} />
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

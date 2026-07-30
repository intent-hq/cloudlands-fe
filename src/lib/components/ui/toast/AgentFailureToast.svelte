<script lang="ts">
  import Fa from 'svelte-fa';
  import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
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
    onRetry,
    onSwitchTo,
    onClose,
  }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the destructive border tint is passed as a wrapper class by the service. -->
<div class="flex items-start gap-3 max-w-[500px]">
  <!-- Icon -->
  <div class="flex-shrink-0 mt-0.5 text-destructive">
    <Fa icon={faExclamationCircle} class="w-5 h-5" />
  </div>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground">{title}</p>
    <p class="text-sm text-muted-foreground line-clamp-2 mt-0.5">{errorSummary}</p>

    {#if contextLine}
      <p class="text-xs text-muted-foreground truncate mt-1.5">{contextLine}</p>
    {/if}

    {#if retryNote}
      <p class="text-xs text-destructive mt-1.5">{retryNote}</p>
    {/if}

    <!-- Action buttons -->
    <div class="flex items-center gap-2 mt-3">
      <Button variant="outline" size="sm" disabled={retrying} onclick={onRetry}>
        {retrying ? m.ui_agentFailureToast_retrying_label() : retryLabel}
      </Button>
      <Button variant="ghost" size="sm" onclick={onSwitchTo}>
        {m.agent_failureToast_switchTo_label()}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={onClose}
    aria-label={m.ui_agentFailureToast_close_ariaLabel()}
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  </button>
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

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    /** Headline, e.g. "3 agents failed" or "Implementor failed". */
    title: string;
    /** Truncated representative error message for the group. */
    errorSummary: string;
    /** Resolved "Agent — Workspace" lines (may be empty when unresolvable),
     *  keyed by agentId — labels can collide (same-named agents in one
     *  workspace), so the each block must not key by the label text. */
    detailLines: Array<{ key: string; label: string }>;
    /** "Retry All N Agents" (N>1) or "Retry <name>" (N=1). */
    retryLabel: string;
    /** Disables the retry button while retries are in flight. */
    retrying: boolean;
    /** Brief note when some retries failed (entry kept in the group). */
    retryNote?: string;
    onRetry: () => void;
    onClose: () => void;
  }

  let { title, errorSummary, detailLines, retryLabel, retrying, retryNote, onRetry, onClose }: Props =
    $props();
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

    {#if detailLines.length > 0}
      <ul class="mt-1.5 space-y-0.5">
        {#each detailLines as line (line.key)}
          <li class="text-xs text-muted-foreground truncate">{line.label}</li>
        {/each}
      </ul>
    {/if}

    {#if retryNote}
      <p class="text-xs text-destructive mt-1.5">{retryNote}</p>
    {/if}

    <!-- Action buttons -->
    <div class="flex items-center gap-2 mt-3">
      <Button variant="outline" size="sm" disabled={retrying} onclick={onRetry}>
        {retrying ? 'Retrying…' : retryLabel}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={onClose}
    aria-label="Close"
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

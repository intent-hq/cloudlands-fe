<script lang="ts">
  import type { StartupState } from '$shared/startup-status';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatCompactDuration } from '$lib/i18n/format';

  let { state }: { state: StartupState } = $props();
  const snapshot = $derived(state.available ? state.snapshot : null);
  const indexing = $derived(snapshot?.phase === 'indexing');
  const unchanged = $derived(indexing && snapshot!.progressAgeMs >= 30_000);
  const estimate = $derived(indexing && !unchanged ? snapshot?.estimatedRemainingMs : undefined);
</script>

<section
  aria-live="polite"
  aria-atomic="true"
  class="space-y-3"
  data-testid="daemon-startup-progress"
>
  <h2 id="daemon-startup-title" class="text-lg font-semibold text-foreground">
    {#if !state.available}
      {m.daemonStartup_unavailable_label()}
    {:else if snapshot?.phase === 'failed'}
      {m.daemonStartup_failed_label()}
    {:else if indexing}
      {m.daemonStartup_indexing_label()}
    {:else if snapshot?.phase === 'finalizing' || snapshot?.phase === 'ready'}
      {m.daemonStartup_finalizing_label()}
    {:else}
      {m.daemonStartup_preparing_label()}
    {/if}
  </h2>
  {#if snapshot && snapshot.phase !== 'failed'}
    <p class="text-sm text-muted-foreground">
      {m.daemonStartup_elapsed_label({
        duration: formatCompactDuration(Math.floor(snapshot.elapsedMs / 1000) * 1000),
      })}
    </p>
    {#if snapshot.progress}
      <p>
        {m.daemonStartup_notes_label({
          completed: formatInteger(snapshot.progress.completedNotes),
          total: formatInteger(snapshot.progress.totalNotes),
        })}
      </p>
    {/if}
    {#if indexing}
      <p class="text-sm text-muted-foreground">
        {#if unchanged}
          {m.daemonStartup_unchanged_description()}
        {:else if estimate !== undefined}
          {m.daemonStartup_remaining_label({
            duration: formatCompactDuration(Math.ceil(estimate / 1000) * 1000),
          })}
        {:else}
          {m.daemonStartup_estimating_label()}
        {/if}
      </p>
    {:else if snapshot.phase === 'finalizing' || snapshot.phase === 'ready'}
      <p class="text-sm text-muted-foreground">{m.daemonStartup_finalizing_description()}</p>
    {/if}
  {:else if snapshot?.phase === 'failed'}
    <p class="text-sm text-muted-foreground">{m.daemonStartup_failed_description()}</p>
  {:else if !state.available}
    <p class="text-sm text-muted-foreground">{m.daemonStartup_unavailable_description()}</p>
  {/if}
</section>

<script lang="ts">
  /**
   * Daemon startup progress (docs/protocol/startup-readiness.md): shown in the
   * daemon-loss overlay while the connected daemon is still starting or has
   * failed to start. It renders only what the daemon's latest snapshot says;
   * a failed status read is shown as unavailable rather than as current.
   */
  import type { DaemonStartupState } from '$shared/daemon-startup';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatCompactDuration } from '$lib/i18n/format';

  // The protocol's progress counters reset this long after the last change.
  const UNCHANGED_AFTER_MS = 30_000;

  let { state }: { state: DaemonStartupState } = $props();
  const failed = $derived(state.state === 'failed' || state.snapshot?.phase === 'failed');
  const snapshot = $derived(state.available && !failed ? state.snapshot : null);
  const indexing = $derived(snapshot?.phase === 'indexing');
  const finalizing = $derived(snapshot?.phase === 'finalizing' || snapshot?.phase === 'ready');
  const unchanged = $derived(indexing && (snapshot?.progressAgeMs ?? 0) >= UNCHANGED_AFTER_MS);
  const estimate = $derived(indexing && !unchanged ? snapshot?.estimatedRemainingMs : undefined);
</script>

<section aria-live="polite" aria-atomic="true" data-testid="daemon-startup-progress">
  <h2 id="daemon-startup-title" class="text-lg font-semibold text-foreground">
    {#if failed}
      {m.daemonStartup_failed_label()}
    {:else if !snapshot}
      {m.daemonStartup_unavailable_label()}
    {:else if indexing}
      {m.daemonStartup_indexing_label()}
    {:else if finalizing}
      {m.daemonStartup_finalizing_label()}
    {:else}
      {m.daemonStartup_preparing_label()}
    {/if}
  </h2>
  {#if failed}
    <p id="daemon-startup-description" class="mt-2 text-sm text-muted-foreground">
      {m.daemonStartup_failed_description()}
    </p>
  {:else if !snapshot}
    <p id="daemon-startup-description" class="mt-2 text-sm text-muted-foreground">
      {m.daemonStartup_unavailable_description()}
    </p>
  {:else}
    <div id="daemon-startup-description" class="mt-2 space-y-1 text-sm text-muted-foreground">
      <p data-testid="daemon-startup-elapsed">
        {m.daemonStartup_elapsed_label({
          duration: formatCompactDuration(Math.floor(snapshot.elapsedMs / 1000) * 1000),
        })}
      </p>
      {#if snapshot.progress}
        <p class="text-foreground" data-testid="daemon-startup-notes">
          {m.daemonStartup_notes_label({
            completed: formatInteger(snapshot.progress.completedNotes),
            total: formatInteger(snapshot.progress.totalNotes),
          })}
        </p>
      {/if}
      {#if indexing}
        <p data-testid="daemon-startup-estimate">
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
      {:else if finalizing}
        <p>{m.daemonStartup_finalizing_description()}</p>
      {/if}
    </div>
  {/if}
</section>

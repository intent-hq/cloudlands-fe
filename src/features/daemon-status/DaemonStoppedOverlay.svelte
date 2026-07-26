<script lang="ts" module>
  /**
   * Grace period before the overlay appears once health goes 'down' (#439).
   * A fast daemon restart or the app-startup connect must not flash the modal;
   * main-side reconnect polling is ≤5s, so 2.5s absorbs quick blips.
   */
  export const DAEMON_STOPPED_GRACE_MS = 2500;
</script>

<script lang="ts">
  /**
   * DaemonStoppedOverlay — full-screen blocking overlay shown when the intentd
   * daemon connection is lost (#439).
   *
   * Driven by the daemon-health slice: shows after a grace period while
   * health === 'down', auto-dismisses when backend:status returns 'connected'
   * (resubscription on reconnect is handled by the existing RESUB-1 path — this
   * component issues no wire requests itself). Offers the app-managed sidecar
   * fallback when the connection mode is external or the sidecar supervisor
   * gave up restarting.
   */
  import { store as appStore } from '$store/renderer/store';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import {
    selectDaemonHealth,
    selectDaemonTransport,
    selectSidecarGaveUp,
    selectSidecarGaveUpReason,
    selectSidecarStartupFailed,
    selectSidecarStartupFailedReason,
    selectHasEverConnected,
    selectSidecarSpawnPending,
    selectSidecarSpawnError,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { spawnSidecarRequested } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import type { SidecarRunLog } from '$store/renderer/slices/daemon-health/daemon-health-types';

  const health$ = selectDaemonHealth();
  const transport$ = selectDaemonTransport();
  const sidecarGaveUp$ = selectSidecarGaveUp();
  const sidecarGaveUpReason$ = selectSidecarGaveUpReason();
  const sidecarStartupFailed$ = selectSidecarStartupFailed();
  const sidecarStartupFailedReason$ = selectSidecarStartupFailedReason();
  const hasEverConnected$ = selectHasEverConnected();
  const spawnPending$ = selectSidecarSpawnPending();
  const spawnError$ = selectSidecarSpawnError();

  // Presentational grace-period latch: health 'down' arms a timer; a recovery
  // before it fires cancels the overlay entirely (no flash on quick blips).
  let visible = $state(false);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if ($health$ === 'down') {
      if (!visible && graceTimer === null) {
        graceTimer = setTimeout(() => {
          graceTimer = null;
          visible = true;
        }, DAEMON_STOPPED_GRACE_MS);
      }
    } else {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
      visible = false;
      // Drop the fetched run log with the dialog — it is stale by the next show.
      runLog = null;
      runLogError = null;
    }
    return () => {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    };
  });

  // Sidecar fallback is offered when the daemon was user-managed (external
  // mode) or when the app-managed sidecar crash-looped past its restart
  // policy. While a sidecar supervisor is still retrying, the button is
  // hidden — the restart policy owns recovery until it gives up.
  const isExternalMode = $derived(
    $transport$?.mode === 'external-uds' || $transport$?.mode === 'external-ws',
  );
  // App-managed failure posture: the app runs its own intentd (transport is
  // sidecar-uds or still unresolved) and either the spawn never happened
  // (startup failure) or the supervisor crash-looped past its restart policy.
  const isSidecarFailure = $derived(
    ($sidecarStartupFailed$ || $sidecarGaveUp$) && !isExternalMode,
  );
  const sidecarFailureReason = $derived(
    $sidecarStartupFailedReason$ ?? $sidecarGaveUpReason$,
  );
  // The on-demand sidecar binds the local UDS socket, which a WS-connected
  // client would never reconnect to — so the button is only offered when the
  // connection target is the local socket (external-ws is excluded). Once a
  // spawn is in flight (or failed), the section stays visible even if a
  // status broadcast flips the transport to sidecar-uds mid-spawn — hiding it
  // would drop the pending indicator / error and any way to retry.
  const showSpawnButton = $derived(
    $transport$?.mode === 'external-uds' ||
      $sidecarGaveUp$ ||
      $spawnPending$ ||
      $spawnError$ !== null,
  );

  function handleSpawnSidecar() {
    appStore.dispatch(spawnSidecarRequested());
  }

  // "Show logs from last run" — fetched on demand from the main process's
  // in-memory per-run capture; ephemeral component-local state (no Redux).
  let runLog = $state<SidecarRunLog | null>(null);
  let runLogError = $state<string | null>(null);
  let runLogPending = $state(false);

  async function handleShowRunLog() {
    runLogPending = true;
    runLogError = null;
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (!api) throw new Error('electronAPI is not available');
      runLog = (await api.invoke(IPC_CHANNELS.BACKEND.GET_SIDECAR_RUN_LOG)) as SidecarRunLog;
    } catch (error) {
      runLogError = error instanceof Error ? error.message : String(error);
    } finally {
      runLogPending = false;
    }
  }
</script>

{#if visible}
  <div
    class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="daemon-stopped-title"
    aria-describedby="daemon-stopped-description"
    tabindex="-1"
    data-testid="daemon-stopped-overlay"
  >
    <div class="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
      <h2 id="daemon-stopped-title" class="text-lg font-semibold text-foreground">
        {#if isSidecarFailure}
          intentd failed to start
        {:else if !$hasEverConnected$}
          Cannot connect to intentd
        {:else}
          intentd is stopped
        {/if}
      </h2>

      <p id="daemon-stopped-description" class="mt-2 text-sm text-muted-foreground">
        {#if isSidecarFailure}
          The app runs its own intentd daemon, and it failed to
          start{sidecarFailureReason ? ` (${sidecarFailureReason})` : ''}.
        {:else if isExternalMode}
          {#if $hasEverConnected$}
            The connection to the external intentd daemon was lost. It may have been stopped or
            crashed.
          {:else}
            Could not connect to the external intentd daemon. It may not be running.
          {/if}
        {:else if $hasEverConnected$}
          The connection to the intentd daemon was lost. The app is restarting it automatically.
        {:else}
          Could not connect to the intentd daemon. The app is starting it automatically.
        {/if}
      </p>

      {#if !isSidecarFailure}
        <p class="mt-3 text-sm text-muted-foreground" data-testid="daemon-stopped-retrying">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500 align-middle"
          ></span>
          <span class="ml-1.5 align-middle">Retrying connection…</span>
        </p>
      {/if}

      {#if isSidecarFailure}
        <div class="mt-4 border-t border-border pt-4">
          <button
            type="button"
            class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={$spawnPending$}
            onclick={handleSpawnSidecar}
            data-testid="daemon-stopped-spawn-sidecar"
          >
            {$spawnPending$ ? 'Starting intentd…' : 'Try starting intentd again'}
          </button>

          {#if $spawnError$}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-spawn-error">
              {$spawnError$}
            </p>
          {/if}

          <button
            type="button"
            class="mt-2 w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={runLogPending}
            onclick={handleShowRunLog}
            data-testid="daemon-stopped-show-logs"
          >
            {runLogPending ? 'Loading logs…' : 'Show logs from last run'}
          </button>

          {#if runLogError}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-run-log-error">
              {runLogError}
            </p>
          {:else if runLog}
            <div class="mt-2" data-testid="daemon-stopped-run-log">
              {#if runLog.available}
                <p class="text-xs text-muted-foreground" data-testid="daemon-stopped-run-log-meta">
                  {#if runLog.spawnError}
                    Spawn error: {runLog.spawnError}
                  {:else}
                    Exit code: {runLog.exitCode ?? 'none'} · Signal: {runLog.signal ?? 'none'}
                  {/if}
                </p>
                <pre
                  class="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
                  data-testid="daemon-stopped-run-log-lines">{runLog.lines.join('\n')}</pre>
              {:else}
                <p class="text-xs text-muted-foreground">
                  No sidecar run has been captured this session.
                </p>
              {/if}
            </div>
          {/if}
        </div>
      {:else if showSpawnButton}
        <div class="mt-4 border-t border-border pt-4">
          <button
            type="button"
            class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={$spawnPending$}
            onclick={handleSpawnSidecar}
            data-testid="daemon-stopped-spawn-sidecar"
          >
            {$spawnPending$ ? 'Starting sidecar…' : 'Start app-managed sidecar'}
          </button>

          {#if $spawnError$}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-spawn-error">
              {$spawnError$}
            </p>
          {/if}

          <p class="mt-2 text-xs text-muted-foreground">
            Note: the app-managed sidecar may use a different data directory than the stopped
            daemon, so your workspaces and agents may differ until the original daemon is back.
          </p>
        </div>
      {/if}
    </div>
  </div>
{/if}

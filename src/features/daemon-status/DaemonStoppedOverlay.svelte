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
  import {
    selectDaemonHealth,
    selectDaemonTransport,
    selectSidecarGaveUp,
    selectSidecarGaveUpReason,
    selectSidecarSpawnPending,
    selectSidecarSpawnError,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { spawnSidecarRequested } from '$store/renderer/slices/daemon-health/daemon-health-slice';

  const health$ = selectDaemonHealth();
  const transport$ = selectDaemonTransport();
  const sidecarGaveUp$ = selectSidecarGaveUp();
  const sidecarGaveUpReason$ = selectSidecarGaveUpReason();
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
  const showSpawnButton = $derived(isExternalMode || $sidecarGaveUp$);

  function handleSpawnSidecar() {
    appStore.dispatch(spawnSidecarRequested());
  }
</script>

{#if visible}
  <div
    class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="daemon-stopped-title"
    data-testid="daemon-stopped-overlay"
  >
    <div class="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
      <h2 id="daemon-stopped-title" class="text-lg font-semibold text-foreground">
        intentd is stopped
      </h2>

      <p class="mt-2 text-sm text-muted-foreground">
        {#if $sidecarGaveUp$}
          The app-managed intentd daemon stopped and could not be restarted after repeated
          attempts{$sidecarGaveUpReason$ ? ` (${$sidecarGaveUpReason$})` : ''}.
        {:else if isExternalMode}
          The connection to the external intentd daemon was lost. It may have been stopped or
          crashed.
        {:else}
          The connection to the intentd daemon was lost. The app is restarting it automatically.
        {/if}
      </p>

      <p class="mt-3 text-sm text-muted-foreground" data-testid="daemon-stopped-retrying">
        <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500 align-middle"
        ></span>
        <span class="ml-1.5 align-middle">Retrying connection…</span>
      </p>

      {#if showSpawnButton}
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

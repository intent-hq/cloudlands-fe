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
   * component issues no wire requests itself). Offers actionable recovery when
   * the connection is down (T20): "Start local intentd" (offered in any
   * external mode — it switches the active backend to local first, then spawns
   * the app-managed sidecar) or the app-managed sidecar retry when the
   * supervisor gave up restarting, plus a one-click switch to any other saved
   * backend so the user can fail over without opening the daemon-status menu.
   */
  import { page } from '$app/stores';
  import { store as appStore } from '$store/renderer/store';
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
    selectSidecarRunLog,
    selectSidecarRunLogPending,
    selectSidecarRunLogError,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import {
    spawnSidecarRequested,
    switchLocalAndSpawnRequested,
    fetchSidecarRunLogRequested,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    selectConnections,
    selectActiveConnectionId,
    selectIsConnecting,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { switchConnection } from '$store/renderer/middlewares/connections-service';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import type { ConnectionRecord } from '$shared/types/connections';
  import { m } from '$shared/paraglide/messages.js';

  const health$ = selectDaemonHealth();
  const transport$ = selectDaemonTransport();
  const sidecarGaveUp$ = selectSidecarGaveUp();
  const sidecarGaveUpReason$ = selectSidecarGaveUpReason();
  const sidecarStartupFailed$ = selectSidecarStartupFailed();
  const sidecarStartupFailedReason$ = selectSidecarStartupFailedReason();
  const hasEverConnected$ = selectHasEverConnected();
  const spawnPending$ = selectSidecarSpawnPending();
  const spawnError$ = selectSidecarSpawnError();
  const runLog$ = selectSidecarRunLog();
  const runLogPending$ = selectSidecarRunLogPending();
  const runLogError$ = selectSidecarRunLogError();
  const connections$ = selectConnections();
  const activeConnectionId$ = selectActiveConnectionId();
  const isConnecting$ = selectIsConnecting();

  // Presentational grace-period latch: health 'down' arms a timer; a recovery
  // before it fires cancels the overlay entirely (no flash on quick blips).
  let visible = $state(false);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const isSandboxPage = $derived(
    $page.url.pathname === '/sandbox' ||
      $page.url.pathname.startsWith('/sandbox/') ||
      $page.url.pathname === '/test' ||
      $page.url.pathname.startsWith('/test/'),
  );

  $effect(() => {
    if ($health$ === 'down' && !isSandboxPage) {
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
  // App-managed failure posture: the app runs its own intentd (transport is
  // sidecar-uds or still unresolved) and either the spawn never happened
  // (startup failure) or the supervisor crash-looped past its restart policy.
  const isSidecarFailure = $derived(
    ($sidecarStartupFailed$ || $sidecarGaveUp$) && !isExternalMode,
  );
  // "Start local intentd" is offered in any external mode — external-uds AND
  // external-ws (T20). The on-demand sidecar binds the local UDS socket, which a
  // WS-connected client would never reconnect to on its own, so handleSpawnSidecar
  // first switches the active backend to local (making the spawned sidecar's UDS
  // the reconnect target) before requesting the spawn. Once a spawn is in flight
  // (or failed), the section stays visible even if a status broadcast flips the
  // transport to sidecar-uds mid-spawn — hiding it would drop the pending
  // indicator / error and any way to retry.
  const showSpawnButton = $derived(
    isExternalMode || $sidecarGaveUp$ || $spawnPending$ || $spawnError$ !== null,
  );

  // Other saved backends the user can fail over to without opening the menu
  // (T20). Excludes the local entry — "Start local intentd" is its dedicated
  // action — and the currently-active connection (switching to it is a no-op).
  const otherConnections = $derived(
    $connections$.filter((c) => !c.isLocal && c.id !== $activeConnectionId$),
  );

  /** Display label for a remote connection: `hostname (host:port)`, or its raw label. */
  function connectionLabel(conn: ConnectionRecord): string {
    const hostname = conn.hostname?.trim();
    if (hostname && conn.host && conn.port != null) {
      return `${hostname} (${conn.host}:${conn.port})`;
    }
    return conn.label;
  }

  function handleSpawnSidecar() {
    // In external/remote mode the active target is a remote backend; the
    // on-demand sidecar binds the local UDS socket, so we must switch active →
    // local first (making that UDS the reconnect target) before spawning.
    //
    // The switch destroys THIS window (captureAndCloseWindowsForBackendSwitch)
    // before the switch IPC returns, so a renderer continuation that dispatched
    // the spawn afterwards could be torn down before it ran — leaving the user on
    // a fresh local window with intentd never started. Route the whole recovery
    // through a single main-side action that switches AND spawns atomically, so
    // it survives the window teardown.
    if ($activeConnectionId$ !== LOCAL_CONNECTION_ID) {
      appStore.dispatch(switchLocalAndSpawnRequested());
      return;
    }
    // Already local: no switch, no window teardown — the plain spawn path is safe.
    appStore.dispatch(spawnSidecarRequested());
  }

  async function handleSwitchConnection(id: string) {
    try {
      await switchConnection(id);
    } catch {
      // Failure surfaces via the connections slice op-status; the list/active
      // refresh arrives via the connections:changed push.
    }
  }

  // "Show logs from last run" — the daemon-health middleware performs the
  // backend:get-sidecar-run-log invoke; the slice holds the payload and drops
  // it on the next successful connect (when this dialog dismisses).
  function handleShowRunLog() {
    appStore.dispatch(fetchSidecarRunLogRequested());
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
          {$sidecarStartupFailed$
            ? m.daemonStatus_overlay_startupFailedTitle_label()
            : m.daemonStatus_overlay_stoppedUnexpectedlyTitle_label()}
        {:else if !$hasEverConnected$}
          {m.daemonStatus_overlay_cannotConnectTitle_label()}
        {:else}
          {m.daemonStatus_overlay_stoppedTitle_label()}
        {/if}
      </h2>

      <p id="daemon-stopped-description" class="mt-2 text-sm text-muted-foreground">
        {#if isSidecarFailure}
          {#if $sidecarStartupFailed$}
            {$sidecarStartupFailedReason$
              ? m.daemonStatus_overlay_startupFailedWithReason_description({
                  reason: $sidecarStartupFailedReason$,
                })
              : m.daemonStatus_overlay_startupFailed_description()}
          {:else}
            {$sidecarGaveUpReason$
              ? m.daemonStatus_overlay_gaveUpWithReason_description({
                  reason: $sidecarGaveUpReason$,
                })
              : m.daemonStatus_overlay_gaveUp_description()}
          {/if}
        {:else if isExternalMode}
          {#if $hasEverConnected$}
            {m.daemonStatus_overlay_externalLost_description()}
          {:else}
            {m.daemonStatus_overlay_externalNeverConnected_description()}
          {/if}
        {:else if $hasEverConnected$}
          {m.daemonStatus_overlay_lost_description()}
        {:else}
          {m.daemonStatus_overlay_neverConnected_description()}
        {/if}
      </p>

      {#if !isSidecarFailure}
        <p class="mt-3 text-sm text-muted-foreground" data-testid="daemon-stopped-retrying">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500 align-middle"
          ></span>
          <span class="ml-1.5 align-middle">{m.daemonStatus_overlay_retrying_label()}</span>
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
            {$spawnPending$
              ? m.daemonStatus_overlay_startingIntentd_label()
              : m.daemonStatus_overlay_tryStartAgain_label()}
          </button>

          {#if $spawnError$}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-spawn-error">
              {$spawnError$}
            </p>
          {/if}

          <button
            type="button"
            class="mt-2 w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={$runLogPending$}
            onclick={handleShowRunLog}
            data-testid="daemon-stopped-show-logs"
          >
            {$runLogPending$
              ? m.daemonStatus_overlay_loadingLogs_label()
              : m.daemonStatus_overlay_showRunLog_label()}
          </button>

          {#if $runLogError$}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-run-log-error">
              {$runLogError$}
            </p>
          {:else if $runLog$}
            <div class="mt-2" data-testid="daemon-stopped-run-log">
              {#if $runLog$.available}
                <p class="text-xs text-muted-foreground" data-testid="daemon-stopped-run-log-meta">
                  {#if $runLog$.spawnError}
                    {m.daemonStatus_overlay_spawnErrorMeta_label({ error: $runLog$.spawnError })}
                  {:else}
                    {m.daemonStatus_overlay_exitMeta_label({
                      exitCode: $runLog$.exitCode ?? m.daemonStatus_overlay_none_label(),
                      signal: $runLog$.signal ?? m.daemonStatus_overlay_none_label(),
                    })}
                  {/if}
                </p>
                <pre
                  class="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
                  data-testid="daemon-stopped-run-log-lines">{$runLog$.lines.join('\n')}</pre>
              {:else}
                <p class="text-xs text-muted-foreground">
                  {m.daemonStatus_overlay_noRunCaptured_label()}
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
            {$spawnPending$
              ? m.daemonStatus_overlay_startingIntentd_label()
              : m.daemonStatus_overlay_startLocalIntentd_label()}
          </button>

          {#if $spawnError$}
            <p class="mt-2 text-sm text-destructive" data-testid="daemon-stopped-spawn-error">
              {$spawnError$}
            </p>
          {/if}

          <p class="mt-2 text-xs text-muted-foreground">
            {m.daemonStatus_overlay_dataDirNote_label()}
          </p>
        </div>
      {/if}

      {#if otherConnections.length > 0}
        <div class="mt-4 border-t border-border pt-4" data-testid="daemon-stopped-known-backends">
          <p class="text-xs text-muted-foreground">
            {m.daemonStatus_overlay_knownBackends_label()}
          </p>
          <div class="mt-2 space-y-2">
            {#each otherConnections as conn (conn.id)}
              <button
                type="button"
                class="w-full truncate rounded-md border border-border px-4 py-2 text-left text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={$isConnecting$}
                onclick={() => handleSwitchConnection(conn.id)}
                data-testid="daemon-stopped-switch-backend"
              >
                {connectionLabel(conn)}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

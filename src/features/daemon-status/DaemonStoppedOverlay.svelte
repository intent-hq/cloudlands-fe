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
   * the connection is down (T20, Open-only — no action retargets this window):
   * "Start local intentd" in a local window (spawns the app-managed sidecar) /
   * "Open local" in a remote window (spawns if needed and opens the local
   * backend's windows), the sidecar retry when the supervisor gave up
   * restarting, plus one-click Open actions for the other saved backends so
   * the user can fail over without opening the daemon-status menu.
   */
  import { page } from '$app/stores';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectDaemonHealth,
    selectDaemonTransport,
    selectReconnectAttempts,
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
    openLocalAndSpawnRequested,
    fetchSidecarRunLogRequested,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    selectConnections,
    selectCurrentConnectionId,
    selectIsConnecting,
    selectActiveAuthRejected,
    selectCurrentConnectionCertWarnings,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import type { ConnectionRecord } from '$shared/types/connections';
  import ConnectBackendModal from '$lib/components/layout/ConnectBackendModal.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  const health$ = selectDaemonHealth();
  const transport$ = selectDaemonTransport();
  const reconnectAttempts$ = selectReconnectAttempts();
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
  const activeConnectionId$ = selectCurrentConnectionId();
  const isConnecting$ = selectIsConnecting();
  const authRejected$ = selectActiveAuthRejected();
  const certWarnings$ = selectCurrentConnectionCertWarnings();
  const repairConnection = $derived(
    $connections$.find((connection) => connection.id === $authRejected$?.id),
  );

  // Presentational grace-period latch: health 'down' arms a timer; a recovery
  // before it fires cancels the overlay entirely (no flash on quick blips).
  let visible = $state(false);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const isSandboxPage = $derived(
    $page.url.pathname === '/sandbox' ||
      $page.url.pathname.startsWith('/sandbox/') ||
      $page.url.pathname.startsWith('/test-'),
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
  const isSidecarFailure = $derived(($sidecarStartupFailed$ || $sidecarGaveUp$) && !isExternalMode);
  // Local recovery is offered in any external mode — external-uds AND
  // external-ws (T20). In a local window the action just spawns the on-demand
  // sidecar ("Start local intentd"); in a remote window it becomes "Open local"
  // — spawn (if needed) plus open/focus the local backend's windows, leaving
  // THIS window on its own backend (Open-only: no overlay action retargets a
  // window). Once a spawn is in flight (or failed), the section stays visible
  // even if a status broadcast flips the transport to sidecar-uds mid-spawn —
  // hiding it would drop the pending indicator / error and any way to retry.
  const showSpawnButton = $derived(
    isExternalMode || $sidecarGaveUp$ || $spawnPending$ || $spawnError$ !== null,
  );
  // Remote window: this window's backend is a stored remote connection, so
  // local recovery opens the local backend's windows instead of spawning into
  // this window's dead connection.
  const isRemoteWindow = $derived($activeConnectionId$ !== LOCAL_CONNECTION_ID);

  // Other saved backends the user can open windows for without leaving this
  // one (T20, Open-only). Excludes the local entry — "Open local" / "Start
  // local intentd" is its dedicated action — and this window's own backend.
  const otherConnections = $derived(
    $connections$.filter((c) => !c.isLocal && c.id !== $activeConnectionId$),
  );

  // Actionable token-rejected posture: this window's remote backend rejected the
  // WebSocket upgrade with HTTP 401/403 (`connections:auth-rejected`), so
  // retrying with the same stored token cannot succeed. The overlay swaps the
  // generic cannot-connect copy for a re-pair state: no "Retrying…" indicator
  // (it would be misleading), and a Re-pair button that opens the
  // add-connection flow with host/port prefilled — re-adding the same
  // host:port replaces the stored token and rebuilds the live client in
  // place, and the fresh client clears the latched rejection
  // (connectOperationStarted).
  const isAuthRejected = $derived($authRejected$ !== null);
  let repairModalOpen = $state(false);

  /** Display label for a remote connection: `hostname (host:port)`, or its raw label. */
  function connectionLabel(conn: ConnectionRecord): string {
    const hostname = conn.hostname?.trim();
    if (hostname && conn.host && conn.port != null) {
      return `${hostname} (${conn.host}:${conn.port})`;
    }
    return conn.label;
  }

  // Connection details for the lost external daemon (#1750): prefer this
  // window's connection record's `hostname (host:port)` label (captured from
  // host.status on first connect); fall back to the transport target (sanitized
  // WS URL or UDS socket path) when the window's backend is the local entry
  // (external-uds adoption) or the record has not loaded.
  const activeConnection = $derived(
    $connections$.find((c) => c.id === $activeConnectionId$) ?? null,
  );
  const externalTargetLabel = $derived.by(() => {
    if (activeConnection && !activeConnection.isLocal) return connectionLabel(activeConnection);
    return $transport$?.target ?? null;
  });

  function handleSpawnSidecar() {
    // Remote window: "Open local" — main spawns the sidecar (if needed) and
    // opens/focuses the local backend's windows in one main-side action, so
    // recovery completes even if this renderer goes away mid-flight. This
    // window keeps its own (dead) backend and this overlay.
    if (isRemoteWindow) {
      appStore.dispatch(openLocalAndSpawnRequested());
      return;
    }
    // Local window: plain spawn — the window's client reconnects to the local
    // UDS socket on its own once the daemon serves it.
    appStore.dispatch(spawnSidecarRequested());
  }

  async function handleOpenConnection(id: string) {
    try {
      const action = openConnectionRequested(id);
      appStore.dispatch(action);
      await action.promise;
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
  <Portal target="body" zIndex={1000}>
    <div
      class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="daemon-stopped-title"
      aria-describedby="daemon-stopped-description"
      tabindex="-1"
      data-testid="daemon-stopped-overlay"
    >
      <div
        class="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
      >
        <h2 id="daemon-stopped-title" class="text-lg font-semibold text-foreground">
          {#if isAuthRejected}
            {m.daemonStatus_overlay_authRejectedTitle_label()}
          {:else if isSidecarFailure}
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
          {#if isAuthRejected && $authRejected$}
            {$authRejected$.statusCode === 403
              ? m.daemonStatus_overlay_authRejectedDisabled_description({
                  host: $authRejected$.host,
                  port: $authRejected$.port,
                })
              : m.daemonStatus_overlay_authRejectedToken_description({
                  host: $authRejected$.host,
                  port: $authRejected$.port,
                })}
          {:else if isSidecarFailure}
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

        {#if !isSidecarFailure && !isAuthRejected && isExternalMode && externalTargetLabel}
          <p
            class="mt-2 truncate font-mono text-xs text-muted-foreground"
            title={externalTargetLabel}
            data-testid="daemon-stopped-connection-details"
          >
            {$hasEverConnected$
              ? m.daemonStatus_overlay_externalLostDetail_label({ target: externalTargetLabel })
              : m.daemonStatus_overlay_externalNeverConnectedDetail_label({
                  target: externalTargetLabel,
                })}
          </p>
        {/if}

        {#if !isSidecarFailure && !isAuthRejected}
          <p class="mt-3 text-sm text-muted-foreground" data-testid="daemon-stopped-retrying">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500 align-middle"
            ></span>
            <span class="ml-1.5 align-middle">
              {$reconnectAttempts$ > 0
                ? m.daemonStatus_overlay_retryingWithAttempts_label({
                    attempt: $reconnectAttempts$,
                  })
                : m.daemonStatus_overlay_retrying_label()}
            </span>
          </p>
        {/if}

        <!--
          Passive per-host cert warnings (#1746 follow-up): the multi-host
          connection race observed candidates presenting a foreign pinned
          cert. Informative only — retries continue unaffected, nothing here
          blocks or offers an action.
        -->
        {#if $certWarnings$.length > 0}
          <div
            class="mt-3 rounded-md border border-yellow-600/40 bg-yellow-500/10 p-2"
            data-testid="daemon-stopped-cert-warnings"
          >
            <p class="text-xs text-muted-foreground">
              {m.daemonStatus_overlay_certWarnings_label()}
            </p>
            <ul class="mt-1 space-y-1">
              {#each $certWarnings$ as warning (warning.host)}
                <li
                  class="truncate font-mono text-xs text-muted-foreground"
                  title={m.daemonStatus_overlay_certWarningDetail_label({
                    expected: warning.expectedFingerprint,
                    actual: warning.actualFingerprint,
                  })}
                  data-testid="daemon-stopped-cert-warning-host"
                >
                  {warning.host}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if isAuthRejected}
          <div class="mt-4 border-t border-border pt-4">
            <button
              type="button"
              class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={$isConnecting$}
              onclick={() => (repairModalOpen = true)}
              data-testid="daemon-stopped-repair"
            >
              {m.daemonStatus_overlay_repair_label()}
            </button>
          </div>
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
              <p class="mt-2 text-sm text-danger" data-testid="daemon-stopped-spawn-error">
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
              <p class="mt-2 text-sm text-danger" data-testid="daemon-stopped-run-log-error">
                {$runLogError$}
              </p>
            {:else if $runLog$}
              <div class="mt-2" data-testid="daemon-stopped-run-log">
                {#if $runLog$.available}
                  <p
                    class="text-xs text-muted-foreground"
                    data-testid="daemon-stopped-run-log-meta"
                  >
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
              {#if $spawnPending$}
                {m.daemonStatus_overlay_startingIntentd_label()}
              {:else if isRemoteWindow}
                {m.daemonStatus_overlay_openLocal_label()}
              {:else}
                {m.daemonStatus_overlay_startLocalIntentd_label()}
              {/if}
            </button>

            {#if $spawnError$}
              <p class="mt-2 text-sm text-danger" data-testid="daemon-stopped-spawn-error">
                {$spawnError$}
              </p>
            {/if}

            <p class="mt-2 text-xs text-muted-foreground">
              {isRemoteWindow
                ? m.daemonStatus_overlay_openLocalDataNote_label()
                : isExternalMode
                  ? m.daemonStatus_overlay_externalDataNote_label()
                  : m.daemonStatus_overlay_dataDirNote_label()}
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
                  onclick={() => handleOpenConnection(conn.id)}
                  data-testid="daemon-stopped-open-backend"
                >
                  {m.daemonStatus_overlay_openBackend_label({ label: connectionLabel(conn) })}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </Portal>

  <ConnectBackendModal
    bind:open={repairModalOpen}
    prefillLabel={repairConnection?.label ?? null}
    prefillAccent={repairConnection?.accent}
    prefillHost={$authRejected$?.host ?? null}
    prefillPort={$authRejected$?.port ?? null}
  />
{/if}

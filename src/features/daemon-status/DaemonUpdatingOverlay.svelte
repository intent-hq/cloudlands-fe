<script lang="ts" module>
  /**
   * How long an update-caused disconnect is shown as "Updating intentd…"
   * before the connection-failure overlay (with its backend-switch actions)
   * takes over. Replaces — does not add to — DaemonStoppedOverlay's grace.
   */
  export const DAEMON_UPDATING_COUNTDOWN_MS = 10_000;
</script>

<script lang="ts">
  /**
   * DaemonUpdatingOverlay — device recovery overlay shown when the
   * daemon connection dropped because the user requested an intentd update.
   *
   * Driven by the daemon-health slice: visible while health === 'down' and
   * `daemonUpdateDisconnectedAt` (the main-side first-drop timestamp carried
   * on backend:status) is younger than DAEMON_UPDATING_COUNTDOWN_MS. Because
   * main stamps the time once per restart, every window of the backend —
   * including one opened mid-outage — counts down to the same deadline.
   * Offers no actions — the daemon is restarting and the client reconnects on
   * its own; DaemonStoppedOverlay defers to this window and appears only if
   * the countdown runs out.
   */
  import { page } from '$app/stores';
  import {
    selectDaemonHealth,
    selectDaemonUpdateDisconnectedAt,
    selectDaemonStartup,
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import DaemonRecoveryFrame from './DaemonRecoveryFrame.svelte';
  import { m } from '$shared/paraglide/messages.js';

  const health$ = selectDaemonHealth();
  const updateDisconnectedAt$ = selectDaemonUpdateDisconnectedAt();
  // A restarted daemon that reports startup progress shows the startup screen
  // (DaemonStoppedOverlay) instead of this countdown.
  const daemonStartup$ = selectDaemonStartup();
  // Once the startup screen took over this outage it keeps it, even if the
  // startup state later clears: never stack both connection overlays.
  let startupShown = $state(false);

  const isSandboxPage = $derived(
    $page.url.pathname === '/sandbox' ||
      $page.url.pathname.startsWith('/sandbox/') ||
      $page.url.pathname.startsWith('/test-'),
  );

  // Milliseconds left in the updating window, re-derived once per second from
  // the latched disconnect time so the countdown is wall-clock accurate rather
  // than tick-counted. 0 (or less) hides the overlay.
  let remainingMs = $state(0);
  let tickTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTick() {
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  }

  $effect(() => {
    if ($health$ !== 'down') startupShown = false;
    else if ($daemonStartup$) startupShown = true;
  });

  $effect(() => {
    const disconnectedAt = $updateDisconnectedAt$;
    if ($health$ === 'down' && disconnectedAt !== null && !isSandboxPage) {
      const deadline = disconnectedAt + DAEMON_UPDATING_COUNTDOWN_MS;
      const tick = () => {
        tickTimer = null;
        remainingMs = deadline - Date.now();
        if (remainingMs > 0) {
          // Fire at the next whole-second boundary of the countdown.
          tickTimer = setTimeout(tick, remainingMs % 1000 || 1000);
        }
      };
      tick();
    } else {
      clearTick();
      remainingMs = 0;
    }
    return clearTick;
  });

  const visible = $derived(remainingMs > 0);
  const seconds = $derived(Math.ceil(remainingMs / 1000));
</script>

{#if visible && !$daemonStartup$ && !startupShown}
  <DaemonRecoveryFrame
    titleId="daemon-updating-title"
    descriptionId="daemon-updating-description"
    testId="daemon-updating-overlay"
  >
    <h2 id="daemon-updating-title" class="type-title text-foreground">
      {m.daemonStatus_updatingOverlay_title_label()}
    </h2>

    <p id="daemon-updating-description" class="mt-2 text-sm text-muted-foreground">
      {m.daemonStatus_updatingOverlay_restarting_description()}
    </p>

    <p class="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
      <span class="first-line-icon"><IntentMarkLoader size={14} /></span>
      <span data-testid="daemon-updating-countdown" data-seconds={seconds}>
        {m.daemonStatus_updatingOverlay_countdown_label({ seconds })}
      </span>
    </p>
  </DaemonRecoveryFrame>
{/if}

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
   * DaemonUpdatingOverlay — calm full-screen blocking overlay shown when the
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
  } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  const health$ = selectDaemonHealth();
  const updateDisconnectedAt$ = selectDaemonUpdateDisconnectedAt();

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

{#if visible}
  <Portal target="body" zIndex={1010}>
    <div
      class="fixed inset-0 z-[1010] flex items-center justify-center bg-black/70 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="daemon-updating-title"
      aria-describedby="daemon-updating-description"
      tabindex="-1"
      data-testid="daemon-updating-overlay"
    >
      <div
        class="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl"
      >
        <h2 id="daemon-updating-title" class="text-lg font-semibold text-foreground">
          {m.daemonStatus_updatingOverlay_title_label()}
        </h2>

        <p id="daemon-updating-description" class="mt-2 text-sm text-muted-foreground">
          {m.daemonStatus_updatingOverlay_restarting_description()}
        </p>

        <p class="mt-3 text-sm text-muted-foreground">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 align-middle"
          ></span>
          <span
            class="ml-1.5 align-middle"
            data-testid="daemon-updating-countdown"
            data-seconds={seconds}
          >
            {m.daemonStatus_updatingOverlay_countdown_label({ seconds })}
          </span>
        </p>
      </div>
    </div>
  </Portal>
{/if}

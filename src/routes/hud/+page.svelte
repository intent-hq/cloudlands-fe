<script lang="ts">
  /**
   * Fleet HUD — standalone chrome-less window shell.
   *
   * Mission-control frame (min 1280x720) faithful to the Fleet HUD v3 mock:
   * dotted-grid background + scanline sweep, header (logo / clock), the
   * 296px / 1fr / 316px column grid, and a bottom footer bar (connection
   * status / workspace state counters / version info). The left column
   * renders the SYSTEM / AGENTS / WORKSPACES panels; the center
   * grid and right column are mount slots for their own tasks. Opened from
   * the sidebar HUD button via WINDOW.OPEN_NEW. Windowed by default; the
   * header control enters native full-screen and the EXIT button (only
   * shown while full-screen, including OS-gesture transitions tracked over
   * the `window:fullscreen` event) leaves it.
   */

  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import { store as appStore } from '$store/renderer/store';
  import {
    hudActivated,
    hudDeactivated,
    hudFullScreenRequested,
  } from '$store/renderer/slices/hud/hud-slice';
  import { selectHudFullScreen } from '$store/renderer/slices/hud/hud-selectors';
  import { HudWorkspaceGrid } from '$features/hud/grid';
  import HudFooter from '$features/hud/components/HudFooter.svelte';
  import HudHeader from '$features/hud/components/HudHeader.svelte';
  import HudLeftColumn from '$features/hud/components/HudLeftColumn.svelte';
  import RightColumn from '$features/hud/right-column/RightColumn.svelte';
  import HudTakeoverOverlay from '$features/hud/takeover/HudTakeoverOverlay.svelte';

  const isFullScreen$ = selectHudFullScreen();
  // Wall-clock tick shared by the clock and the uptime extrapolation.
  let nowMs = $state(Date.now());

  onMount(() => {
    appStore.dispatch(hudActivated());
    const clockTimer = setInterval(() => {
      nowMs = Date.now();
    }, 1000);

    return () => {
      clearInterval(clockTimer);
      appStore.dispatch(hudDeactivated());
    };
  });

  function setFullScreen(fullScreen: boolean) {
    appStore.dispatch(hudFullScreenRequested(fullScreen));
  }
</script>

<div class="hud-shell" data-testid="hud-shell">
  <!-- Dotted-grid background + scanline sweep (mock lines 41-42) -->
  <div class="hud-dot-grid" aria-hidden="true"></div>
  <div class="hud-scan-layer" aria-hidden="true">
    <div class="hud-scan-band"></div>
  </div>

  <HudHeader {nowMs} isFullScreen={$isFullScreen$}>
    {#snippet controls()}
      {#if $isFullScreen$}
        <Button
          class="hud-fullscreen-btn"
          onclick={() => setFullScreen(false)}
          aria-label={m.hud_shell_exitFullScreen_label()}
        >
          <Fa icon={faCompress} size={12} />
          {m.hud_shell_exitFullScreen_label()}
        </Button>
      {:else}
        <Button
          class="hud-fullscreen-btn"
          onclick={() => setFullScreen(true)}
          aria-label={m.hud_shell_enterFullScreen_label()}
        >
          <Fa icon={faExpand} size={12} />
          {m.hud_shell_enterFullScreen_label()}
        </Button>
      {/if}
    {/snippet}
  </HudHeader>

  <main class="hud-grid">
    <HudLeftColumn {nowMs} />

    <!-- Center: workspace-card grid -->
    <div class="hud-center-slot" data-testid="hud-center-slot">
      <HudWorkspaceGrid />
    </div>

    <!-- Right: attention + event feed rail -->
    <div class="hud-right-slot" data-testid="hud-right-slot">
      <RightColumn />
    </div>
  </main>

  <!-- Bottom bar: connection status / workspace counters / versions -->
  <HudFooter />

  <!-- Event takeover spotlight (queue-sequenced, above everything) -->
  <HudTakeoverOverlay {nowMs} />
</div>

<style>
  .hud-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    min-width: 1280px;
    min-height: 720px;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: Inter, system-ui, sans-serif;
    /* Mock's NEEDS INPUT / attention color: the design-system YELLOW warning
       token (raw H S% L% triple so `hsl(var(--warning))` stays valid under an
       explicit theme class). The app-wide `--warning` is an orange amber; the
       HUD subtree inherits this override so the wait banner/border/label, the
       WORKSPACES-BY-STATE attention bar, the header ATTN counter, and the
       ATTENTION panel all render the mock's yellow. Blocked/failed keep red. */
    --warning: 48 96% 53%;
  }
  .hud-dot-grid {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(hsl(var(--foreground) / 0.06) 1px, transparent 1px);
    background-size: 28px 28px;
    pointer-events: none;
  }
  .hud-scan-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .hud-scan-band {
    position: absolute;
    left: 0;
    right: 0;
    height: 160px;
    background: linear-gradient(180deg, transparent, hsl(var(--primary) / 0.07), transparent);
    animation: hudscan 11s linear infinite;
  }
  .hud-grid {
    position: relative;
    flex: 1;
    display: grid;
    grid-template-columns: 296px 1fr 316px;
    gap: 14px;
    padding: 14px 24px;
    min-height: 0;
  }
  .hud-center-slot,
  .hud-right-slot {
    min-height: 0;
  }
  .hud-fullscreen-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    border: 1px solid hsl(var(--border));
    background: transparent;
    padding: 7px 14px;
    font:
      600 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--muted-foreground));
  }
  .hud-fullscreen-btn:hover {
    background: hsl(var(--muted) / 0.5);
  }

  /* Mock keyframes — global: HUD child components reference them. */
  @keyframes -global-hudpulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.2;
    }
  }
  @keyframes -global-hudscan {
    0% {
      top: -160px;
    }
    100% {
      top: 100%;
    }
  }
  @keyframes -global-hudblink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.15;
    }
  }
  @container style(--motion-reduced: 1) {
    .hud-scan-band {
      animation: none;
      display: none;
    }
  }
</style>

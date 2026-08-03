<script lang="ts">
  /**
   * HUD header (mock lines 43-107) — INTENT wordmark, divider, the
   * FLEET OPS repo filter + status filter menus, and a centered live clock.
   * The workspace state counters moved to the bottom footer bar
   * (HudFooter.svelte). No token counter — the
   * TOK/S chart lives in the right column per the mock. The full-screen
   * toggle slot keeps the existing enter/exit control.
   *
   * The HUD window has no WindowTitleBar, so this header is the frameless
   * window's drag region (-webkit-app-region: drag; interactive children are
   * no-drag via the global layout rule). It shares the grid's 24px gutter so
   * the wordmark's left edge aligns with the SYSTEM card below.
   *
   * On macOS the window is frameless (titleBarStyle: hiddenInset,
   * trafficLightPosition y:11), so the traffic lights would sit ON TOP of
   * the header content. A thin 35px spacer strip (same height as the
   * workspace windows' WindowTitleBar) renders ABOVE the header row for the
   * lights to occupy — the header (and the wordmark's 24px left gutter,
   * aligned with the SYSTEM card) moves fully below it. The strip is a drag
   * region so the window can still be moved by its top edge. Non-mac
   * platforms keep their native frame → no strip.
   */
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectThemePreference } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
  import { formatHudClock } from '../utils/hud-format';
  import HudHeaderFilters from './HudHeaderFilters.svelte';

  let { nowMs, controls }: { nowMs: number; controls?: Snippet } = $props();

  /**
   * macOS detection from the preload-exposed `process.platform` (the same
   * bridge the footer's product label reads), falling back to navigator
   * sniffing when the bridge is absent. Only darwin gets the frameless
   * window (frame: false in main), so the spacer strip is darwin-only.
   */
  function isMacPlatform(): boolean {
    const platform: string | undefined =
      typeof window !== 'undefined' ? (window as any).electronAPI?.platform : undefined;
    if (platform) return platform === 'darwin';
    return typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
  }

  const isMac = isMacPlatform();

  const themePreference$ = selectThemePreference();

  const clockText = $derived(formatHudClock(nowMs));

  /**
   * Same order as the main app's ThemeManager.toggleTheme() cycle
   * (light → dark → system → light) and the Settings picker's option order.
   * SYSTEM follows the OS appearance live via the shared theme plumbing
   * (ThemeManager matchMedia listener → theme-changed → Redux).
   */
  const THEME_CYCLE: ThemePreference[] = ['light', 'dark', 'system'];

  const themeLabel = $derived(
    $themePreference$ === 'dark'
      ? m.hud_header_themeDark_label()
      : $themePreference$ === 'light'
        ? m.hud_header_themeLight_label()
        : m.hud_header_themeSystem_label(),
  );

  function cycleTheme() {
    const current = selectThemePreference.select(appStore.state);
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
    appStore.dispatch(requestThemePreferenceChange(next));
  }
</script>

{#if isMac}
  <!-- Traffic-light spacer: drag-region strip the macOS window controls
       occupy so they never cover the header content below. -->
  <div class="hud-titlebar-spacer" data-testid="hud-titlebar-spacer" aria-hidden="true"></div>
{/if}

<header class="hud-header" data-testid="hud-header">
  <div class="hud-header-side hud-header-side-left">
    <!-- i18n-ignore (brand wordmark) -->
    <div class="hud-header-wordmark">INTENT</div>
    <div class="hud-header-sep"></div>
    <HudHeaderFilters />
  </div>
  <div class="hud-header-clock">{clockText}</div>
  <div class="hud-header-side hud-header-side-right">
    <button class="hud-header-theme-btn" data-testid="hud-header-theme-btn" onclick={cycleTheme}>
      {themeLabel}
    </button>
    {#if controls}{@render controls()}{/if}
  </div>
</header>

<style>
  .hud-titlebar-spacer {
    /* 35px matches the workspace windows' WindowTitleBar height and clears
       the traffic lights (trafficLightPosition y:11 + ~14px buttons). */
    height: 35px;
    flex-shrink: 0;
    background: hsl(var(--muted) / 0.5);
    border-bottom: 1px solid hsl(var(--border) / 0.8);
    /* Movable by the top edge, matching workspace-window titlebar behavior. */
    -webkit-app-region: drag;
  }
  .hud-header {
    position: relative;
    /* 1fr | auto | 1fr: the two side tracks stay equal, so the clock sits at
       the true horizontal center of the window (not the center of leftover
       flex space). If a side outgrows half the width, its track expands and
       the clock shifts gracefully — content never wraps or overlaps. */
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 18px;
    height: 64px;
    padding: 0 24px;
    border-bottom: 1px solid hsl(var(--border) / 0.8);
    flex-shrink: 0;
    /* Frameless-window drag region (no WindowTitleBar on the HUD route);
       interactive children are no-drag via the global layout rule. */
    -webkit-app-region: drag;
  }
  .hud-header-side {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
  }
  .hud-header-side-right {
    justify-content: flex-end;
  }
  .hud-header-wordmark {
    font:
      500 17px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.32em;
  }
  .hud-header-sep {
    width: 1px;
    height: 22px;
    background: hsl(var(--border));
  }
  .hud-header-clock {
    font:
      500 26px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .hud-header-theme-btn {
    cursor: pointer;
    border: 1px solid hsl(var(--border));
    background: transparent;
    padding: 7px 14px;
    font:
      600 10px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.15em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-header-theme-btn:hover {
    background: hsl(var(--muted) / 0.5);
  }
</style>

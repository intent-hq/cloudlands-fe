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
   * no-drag via the global app.css rule scoped to .app-drag-region). It shares the
   * grid's 24px gutter so the wordmark's left edge aligns with the SYSTEM
   * card below.
   *
   * On macOS the window is frameless (titleBarStyle: hiddenInset,
   * trafficLightPosition y:11), so the traffic lights would sit ON TOP of
   * the header content. A thin 35px spacer strip (same height as the
   * workspace windows' WindowTitleBar) renders ABOVE the header row for the
   * lights to occupy — the header (and the wordmark's 24px left gutter,
   * aligned with the SYSTEM card) moves fully below it. The strip is a drag
   * region so the window can still be moved by its top edge. Non-mac
   * platforms keep their native frame → no strip. In full screen macOS
   * hides the traffic lights, so the strip hides too (isFullScreen prop).
   */
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectThemePreference } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
  import { formatHudClock } from '../utils/hud-format';
  import {
    hudSoundEnabled,
    hudSoundVolume,
    setHudSoundVolume,
    toggleHudSoundEnabled,
  } from '../sound/hud-sound-state';
  import { playHudSoundCue } from '../sound/hud-sound-player';
  import HudHeaderFilters from './HudHeaderFilters.svelte';

  let {
    nowMs,
    isFullScreen = false,
    controls,
  }: { nowMs: number; isFullScreen?: boolean; controls?: Snippet } = $props();

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

  /**
   * HUD sound-effects toggle — the shared localStorage-backed enable state
   * (default OFF, features/hud/sound/hud-sound-state.ts) the HUD sound
   * player gates on. Toggling ON also plays a quiet confirmation cue: the
   * real `Audio.play()` inside this click gesture unlocks audio under the
   * browser autoplay policy (later queue-driven cues run outside a gesture)
   * and doubles as audible feedback that sound is now on.
   */
  const soundLabel = $derived(
    $hudSoundEnabled ? m.hud_header_soundOn_label() : m.hud_header_soundOff_label(),
  );

  function toggleSound() {
    if (toggleHudSoundEnabled()) {
      void playHudSoundCue('status-update');
    }
  }

  /**
   * Master-volume slider — hover-revealed next to the speaker button; also
   * revealed on focus-within so keyboard users can Tab from the button onto
   * the slider. The value is the shared persisted master volume (default
   * 0.3) every cue play multiplies with its per-cue pack volume.
   */
  let volumeVisible = $state(false);

  function hideVolumeOnFocusLeave(event: FocusEvent) {
    const group = event.currentTarget as HTMLElement;
    if (!group.contains(event.relatedTarget as Node | null)) volumeVisible = false;
  }

  function onVolumeInput(event: Event) {
    setHudSoundVolume(Number((event.currentTarget as HTMLInputElement).value));
  }
</script>

{#if isMac && !isFullScreen}
  <!-- Traffic-light spacer: drag-region strip the macOS window controls
       occupy so they never cover the header content below. Hidden in full
       screen, where macOS hides the traffic lights. -->
  <div class="hud-titlebar-spacer" data-testid="hud-titlebar-spacer" aria-hidden="true"></div>
{/if}

<header class="hud-header app-drag-region" data-testid="hud-header">
  <div class="hud-header-side hud-header-side-left">
    <!-- i18n-ignore (brand wordmark) -->
    <div class="hud-header-wordmark">INTENT</div>
    <div class="hud-header-sep"></div>
    <HudHeaderFilters />
  </div>
  <div class="hud-header-clock">{clockText}</div>
  <div class="hud-header-side hud-header-side-right">
    <div
      class="hud-header-sound-group"
      data-testid="hud-header-sound-group"
      role="group"
      aria-label={m.hud_header_soundControls_ariaLabel()}
      onmouseenter={() => (volumeVisible = true)}
      onmouseleave={() => (volumeVisible = false)}
      onfocusin={() => (volumeVisible = true)}
      onfocusout={hideVolumeOnFocusLeave}
    >
      {#if volumeVisible}
        <input
          class="hud-header-volume-slider"
          data-testid="hud-header-volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={$hudSoundVolume}
          aria-label={m.hud_header_soundVolume_ariaLabel()}
          oninput={onVolumeInput}
        />
      {/if}
      <button
        class="hud-header-sound-btn"
        data-testid="hud-header-sound-btn"
        aria-label={m.hud_header_soundToggle_ariaLabel()}
        aria-pressed={$hudSoundEnabled}
        onclick={toggleSound}
      >
        {soundLabel}
      </button>
    </div>
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
       interactive children are no-drag via the global app.css rule scoped to
       .app-drag-region (which this header carries). */
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
  .hud-header-theme-btn,
  .hud-header-sound-btn {
    cursor: pointer;
    border: 1px solid hsl(var(--border));
    background: transparent;
    padding: 7px 14px;
    font:
      600 10px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.15em;
    color: hsl(var(--muted-foreground));
    text-transform: uppercase;
  }
  .hud-header-theme-btn:hover,
  .hud-header-sound-btn:hover {
    background: hsl(var(--muted) / 0.5);
  }
  .hud-header-sound-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Themed native range input (Electron/Chromium only, so the -webkit-*
     pseudo-elements are sufficient): a hairline border-colored track with a
     small square thumb, matching the bordered JetBrains Mono button look and
     tracking the HUD theme via the same CSS variables. */
  .hud-header-volume-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 88px;
    height: 12px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .hud-header-volume-slider::-webkit-slider-runnable-track {
    height: 2px;
    background: hsl(var(--border));
  }
  .hud-header-volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    margin-top: -4px;
    background: hsl(var(--muted-foreground));
    border: 1px solid hsl(var(--border));
  }
  .hud-header-volume-slider:focus-visible {
    outline: 1px solid hsl(var(--muted-foreground));
    outline-offset: 2px;
  }
</style>

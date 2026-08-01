<script lang="ts">
  /**
   * HUD header (mock lines 43-107) — logo + INTENT wordmark, divider, the
   * FLEET OPS repo filter + status filter menus, centered live clock, fleet
   * stat counters (RUN / ATTN / REVIEW / IDLE / FAILED; ATTN and FAILED blink
   * via hudblink only when their count is > 0 — zero renders static/dimmed
   * like the other counters), and the theme toggle. No token counter — the
   * TOK/S chart lives in the right column per the mock. The full-screen
   * toggle slot keeps the existing enter/exit control.
   *
   * The HUD window has no WindowTitleBar, so this header is the frameless
   * window's drag region (-webkit-app-region: drag; interactive children are
   * no-drag via the global layout rule) and pads left for the macOS traffic
   * lights (hiddenInset title bar, same treatment as WindowTitleBar).
   */
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import Logo from '$lib/components/Logo.svelte';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import { store as appStore } from '$store/renderer/store';
  import { selectHudAgentStateCounts } from '$store/renderer/slices/hud/hud-selectors';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import { formatHudClock } from '../utils/hud-format';
  import HudHeaderFilters from './HudHeaderFilters.svelte';

  let { nowMs, controls }: { nowMs: number; controls?: Snippet } = $props();

  const agentCounts$ = selectHudAgentStateCounts();
  const isDark$ = selectIsDarkTheme();

  const clockText = $derived(formatHudClock(nowMs));

  const stats = $derived({
    run: $agentCounts$.running,
    attn: $agentCounts$.waiting + $agentCounts$.failed,
    rev: $agentCounts$.done,
    idle: $agentCounts$.idle,
    fail: $agentCounts$.failed,
  });

  function toggleTheme() {
    appStore.dispatch(requestThemePreferenceChange($isDark$ ? 'light' : 'dark'));
  }
</script>

<header class="hud-header" class:hud-header-mac={isMacPlatform()} data-testid="hud-header">
  <Logo width={30} class="hud-header-logo" />
  <!-- i18n-ignore (brand wordmark) -->
  <div class="hud-header-wordmark">INTENT</div>
  <div class="hud-header-sep"></div>
  <HudHeaderFilters />
  <div class="hud-header-spacer"></div>
  <div class="hud-header-clock">{clockText}</div>
  <div class="hud-header-spacer"></div>
  <div class="hud-header-stats">
    <div class="hud-header-stat">
      <span class="hud-header-stat-key">{m.hud_header_statRun_label()}</span>
      <span class="hud-header-stat-value hud-stat-run">{stats.run}</span>
    </div>
    <div class="hud-header-stat">
      <span class="hud-header-stat-key">{m.hud_header_statAttn_label()}</span>
      <span
        class="hud-header-stat-value hud-stat-attn"
        class:hud-stat-blink={stats.attn > 0}
        class:hud-stat-zero={stats.attn === 0}
        data-testid="hud-header-stat-attn">{stats.attn}</span
      >
    </div>
    <div class="hud-header-stat">
      <span class="hud-header-stat-key">{m.hud_header_statReview_label()}</span>
      <span class="hud-header-stat-value hud-stat-rev">{stats.rev}</span>
    </div>
    <div class="hud-header-stat">
      <span class="hud-header-stat-key">{m.hud_header_statIdle_label()}</span>
      <span class="hud-header-stat-value hud-stat-idle">{stats.idle}</span>
    </div>
    <div class="hud-header-stat">
      <span class="hud-header-stat-key">{m.hud_header_statFailed_label()}</span>
      <span
        class="hud-header-stat-value hud-stat-fail"
        class:hud-stat-blink={stats.fail > 0}
        class:hud-stat-zero={stats.fail === 0}
        data-testid="hud-header-stat-fail">{stats.fail}</span
      >
    </div>
  </div>
  <button class="hud-header-theme-btn" onclick={toggleTheme}>
    {$isDark$ ? m.hud_header_themeDark_label() : m.hud_header_themeLight_label()}
  </button>
  {#if controls}{@render controls()}{/if}
</header>

<style>
  .hud-header {
    position: relative;
    display: flex;
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
  .hud-header.hud-header-mac {
    /* Clear the macOS traffic lights (hiddenInset title bar). */
    padding-left: 78px;
  }
  .hud-header :global(.hud-header-logo) {
    height: 26px;
    color: hsl(var(--foreground));
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
  .hud-header-spacer {
    flex: 1;
  }
  .hud-header-clock {
    font:
      500 26px 'JetBrains Mono',
      monospace;
    letter-spacing: 0.08em;
  }
  .hud-header-stats {
    display: flex;
    gap: 22px;
    font:
      500 11px 'JetBrains Mono',
      monospace;
  }
  .hud-header-stat {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .hud-header-stat-key {
    color: hsl(var(--text-ghost));
  }
  .hud-header-stat-value {
    font-size: 15px;
  }
  .hud-stat-run {
    color: hsl(var(--primary));
  }
  .hud-stat-attn {
    color: hsl(var(--warning));
  }
  .hud-stat-rev {
    color: hsl(var(--ring));
  }
  .hud-stat-idle {
    color: hsl(var(--text-subtle));
  }
  .hud-stat-fail {
    color: hsl(var(--destructive-foreground));
  }
  .hud-stat-blink {
    animation: hudblink 1.6s step-end infinite;
  }
  .hud-stat-zero {
    color: hsl(var(--text-subtle));
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
  @media (prefers-reduced-motion: reduce) {
    .hud-stat-blink {
      animation: none;
    }
  }
</style>

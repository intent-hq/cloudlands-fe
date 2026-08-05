<script lang="ts">
  /**
   * HUD footer — full-width bottom bar with three zones:
   *  LEFT   daemon connection health (same `selectHudSystem` view the SYSTEM
   *         panel renders: pulsing dot + ONLINE/OFFLINE, live from the
   *         daemon-health slice's 10s poll — 'down' is OFFLINE, 'healthy'
   *         and 'degraded' are ONLINE).
   *  MIDDLE workspace counts by state (IDLE / PROGRESS / ATTENTION /
   *         PR OPEN / PR MERGED / FAILED / COMPLETED) from the SAME
   *         `selectHudWorkspaceStateBars` rollup the left rail and grid use.
   *         ATTENTION and FAILED blink via hudblink only when > 0; zero
   *         renders static/dimmed like the other counters.
   *  RIGHT  version info — "Intent for <platform>" app version
   *         (`__APP_VERSION__`, platform from the preload-exposed
   *         `process.platform`) and the intentd daemon version from the
   *         daemon-health slice's `system.status` poll; the daemon segment
   *         is omitted until the daemon has reported a version.
   */
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectHudSystem,
    selectHudWorkspaceStateBars,
  } from '$store/renderer/slices/hud/hud-selectors';

  /**
   * Human platform name for the product label, from the preload-exposed
   * `process.platform` (browser mock reports 'darwin'), falling back to
   * navigator sniffing when the bridge is absent.
   */
  function platformLabel(): string {
    const platform: string | undefined =
      typeof window !== 'undefined' ? (window as any).electronAPI?.platform : undefined;
    if (platform === 'darwin') return 'macOS';
    if (platform === 'win32') return 'Windows';
    if (platform === 'linux') return 'Linux';
    if (typeof navigator !== 'undefined') {
      if (/Mac/.test(navigator.userAgent)) return 'macOS';
      if (/Win/.test(navigator.userAgent)) return 'Windows';
    }
    return 'Linux';
  }

  const system$ = selectHudSystem();
  const workspaceBars$ = selectHudWorkspaceStateBars();

  const online = $derived($system$.online);
  const daemonVersion = $derived($system$.version);

  const stats = $derived({
    idle: $workspaceBars$.idle,
    unread: $workspaceBars$.unread,
    progress: $workspaceBars$.progress,
    attn: $workspaceBars$.attention,
    prOpen: $workspaceBars$.prOpen,
    prMerged: $workspaceBars$.prMerged,
    fail: $workspaceBars$.failed,
    completed: $workspaceBars$.completed,
  });
</script>

<footer class="hud-footer" data-testid="hud-footer">
  <div class="hud-footer-system" data-testid="hud-footer-system">
    <span class="hud-footer-dot" class:hud-footer-dot-online={online}></span>
    <!-- i18n-ignore (brand/daemon name) -->
    <span class="hud-footer-system-key">INTENTD</span>
    {#if online}
      <span class="hud-footer-online">{m.hud_system_online_label()}</span>
    {:else}
      <span class="hud-footer-offline">{m.hud_system_offline_label()}</span>
    {/if}
  </div>

  <div class="hud-footer-stats" data-testid="hud-footer-stats">
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_idle_label()}</span>
      <span class="hud-footer-stat-value hud-stat-idle">{stats.idle}</span>
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_unread_label()}</span>
      <span class="hud-footer-stat-value hud-stat-unread" data-testid="hud-footer-stat-unread"
        >{stats.unread}</span
      >
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_progress_label()}</span>
      <span class="hud-footer-stat-value hud-stat-run">{stats.progress}</span>
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_attention_label()}</span>
      <span
        class="hud-footer-stat-value hud-stat-attn"
        class:hud-stat-blink={stats.attn > 0}
        class:hud-stat-zero={stats.attn === 0}
        data-testid="hud-footer-stat-attn">{stats.attn}</span
      >
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_prOpen_label()}</span>
      <span class="hud-footer-stat-value hud-stat-rev">{stats.prOpen}</span>
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_prMerged_label()}</span>
      <span class="hud-footer-stat-value hud-stat-merged">{stats.prMerged}</span>
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_failed_label()}</span>
      <span
        class="hud-footer-stat-value hud-stat-fail"
        class:hud-stat-blink={stats.fail > 0}
        class:hud-stat-zero={stats.fail === 0}
        data-testid="hud-footer-stat-fail">{stats.fail}</span
      >
    </div>
    <div class="hud-footer-stat">
      <span class="hud-footer-stat-key">{m.hud_workspaceState_completed_label()}</span>
      <span class="hud-footer-stat-value hud-stat-completed">{stats.completed}</span>
    </div>
  </div>

  <div class="hud-footer-versions" data-testid="hud-footer-versions">
    <!-- i18n-ignore (product name + wire version string) -->
    <span>Intent for {platformLabel()} v{__APP_VERSION__}</span>
    {#if daemonVersion}
      <span class="hud-footer-version-sep"></span>
      <!-- i18n-ignore (brand/daemon name + wire version string) -->
      <span>intentd v{daemonVersion.replace(/^v/, '')}</span>
    {/if}
  </div>
</footer>

<style>
  .hud-footer {
    position: relative;
    display: flex;
    align-items: center;
    gap: 18px;
    height: 40px;
    padding: 0 24px;
    border-top: 1px solid hsl(var(--border) / 0.8);
    flex-shrink: 0;
    font:
      500 11px 'JetBrains Mono',
      monospace;
  }
  .hud-footer-system {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .hud-footer-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--destructive-foreground));
  }
  .hud-footer-dot-online {
    background: hsl(var(--primary));
    animation: hudpulse 2.2s ease-in-out infinite;
  }
  .hud-footer-system-key {
    color: hsl(var(--text-subtle));
    letter-spacing: 0.12em;
  }
  .hud-footer-online {
    color: hsl(var(--primary));
  }
  .hud-footer-offline {
    color: hsl(var(--destructive-foreground));
    animation: hudblink 1.6s step-end infinite;
  }
  .hud-footer-stats {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 16px;
  }
  .hud-footer-stat {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .hud-footer-stat-key {
    color: hsl(var(--text-ghost));
  }
  .hud-footer-stat-value {
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
  .hud-stat-merged {
    color: hsl(262 60% 62%);
  }
  /* Canonical HUD_STATE_COLORS tokens (hud-card-meta): idle grey, unread/PR
     blue, completed the same stable green as running. */
  .hud-stat-idle {
    color: hsl(var(--text-ghost));
  }
  .hud-stat-unread {
    color: hsl(var(--ring));
  }
  .hud-stat-fail {
    color: hsl(var(--destructive-foreground));
  }
  .hud-stat-completed {
    color: hsl(var(--primary));
  }
  .hud-stat-blink {
    animation: hudblink 1.6s step-end infinite;
  }
  .hud-stat-zero {
    color: hsl(var(--text-subtle));
  }
  .hud-footer-versions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: hsl(var(--text-subtle));
    white-space: nowrap;
  }
  .hud-footer-version-sep {
    width: 1px;
    height: 12px;
    background: hsl(var(--border));
  }
  @media (prefers-reduced-motion: reduce) {
    .hud-stat-blink,
    .hud-footer-dot-online,
    .hud-footer-offline {
      animation: none;
    }
  }
</style>
